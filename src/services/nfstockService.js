// src/services/nfstockService.js
const axios = require('axios');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const {
    NFSTOCK_IMP_BASE,
    NFSTOCK_AUTH_URL,
    NFSTOCK_CLIENT_ID,
    NFSTOCK_CLIENT_SECRET,
    NFSTOCK_API_TOKEN,
    CONCURRENCY_UPLOADS,
    BATCH_FLUSH_SIZE
} = require('../config');
const { Buffer } = require('buffer');
const { loadSet, saveSet } = require('../models/processedModel');

let oauthTokenCache = null;
function log(msg) { console.log(`[${new Date().toLocaleString('pt-BR')}] ${msg}`); }

/* ---------------------------
   Upload nativo para presigned URL
   --------------------------- */
async function uploadToPresignedUrl(presignedUrl, buffer, method = 'PUT') {
    const fetchFn = globalThis.fetch;
    if (fetchFn) {
        const resp = await fetchFn(presignedUrl, { method: method, body: buffer });
        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            const err = new Error(`S3 PUT failed via fetch: ${resp.status} ${resp.statusText} - ${text}`);
            err.statusCode = resp.status;
            err.body = text;
            throw err;
        }
        return resp.status;
    }

    return new Promise((resolve, reject) => {
        try {
            const urlObj = new URL(presignedUrl);
            const isHttps = urlObj.protocol === 'https:';
            const port = urlObj.port || (isHttps ? 443 : 80);
            const options = {
                protocol: urlObj.protocol,
                hostname: urlObj.hostname,
                port,
                path: (urlObj.pathname || '') + (urlObj.search || ''),
                method: method,
                headers: {
                    'Content-Length': Buffer.byteLength(buffer)
                },
                timeout: 60000
            };

            const req = (isHttps ? https : http).request(options, (res) => {
                const chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => {
                    const body = Buffer.concat(chunks).toString('utf8');
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        return resolve(res.statusCode);
                    }
                    const err = new Error(`S3 PUT failed: ${res.statusCode}`);
                    err.statusCode = res.statusCode;
                    err.body = body;
                    err.headers = res.headers;
                    return reject(err);
                });
            });

            req.on('error', (err) => reject(err));
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Upload timed out'));
            });

            req.write(buffer);
            req.end();
        } catch (ex) {
            reject(ex);
        }
    });
}

/* ---------------------------
   Token handling
   --------------------------- */
async function obtainTokenViaClientCredentials() {
    if (!NFSTOCK_AUTH_URL || !NFSTOCK_CLIENT_ID || !NFSTOCK_CLIENT_SECRET) {
        throw new Error('Configuração para autenticação OAuth da NF-Stock não encontrada.');
    }
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', NFSTOCK_CLIENT_ID);
    params.append('client_secret', NFSTOCK_CLIENT_SECRET);

    log('NF-Stock: Solicitando novo token de acesso OAuth...');
    const response = await axios.post(NFSTOCK_AUTH_URL, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000
    });

    const data = response.data || {};
    if (!data.access_token) throw new Error('Resposta OAuth da NF-Stock não contém um access_token.');

    const expiresIn = Number(data.expires_in || 300);
    oauthTokenCache = {
        token: data.access_token,
        expiresAt: Date.now() + (expiresIn - 30) * 1000
    };
    log('NF-Stock: Novo token de acesso obtido e armazenado em cache.');
    return oauthTokenCache.token;
}

async function getToken() {
    // se token em env está definido, usa ele (por exemplo token gerado no painel)
    if (NFSTOCK_API_TOKEN) return NFSTOCK_API_TOKEN;
    if (oauthTokenCache && oauthTokenCache.expiresAt > Date.now()) return oauthTokenCache.token;
    return await obtainTokenViaClientCredentials();
}

/* Limpa cache do token OAuth (força next getToken a requisitar novo) */
function clearOauthCache() {
    oauthTokenCache = null;
    log('NF-Stock: oauthTokenCache limpo (forçando refresh em próximo getToken).');
}

/* ---------------------------
   Solicitar presigned URL (/storage)
   --------------------------- */
async function requestUploadUrlWithClient(nfClient, sizeBytes) {
    // Conforme doc: extension ".xml" ou ".zip" (com o ponto)
    const payload = { size: sizeBytes, extension: '.xml' };
    const resp = await nfClient.post('/storage', payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000,
        validateStatus: s => s >= 200 && s < 300
    });
    const d = resp.data || {};
    const url = d.url || d.uploadUrl || d.presignedUrl;
    if (!url) throw new Error(`NF-Stock /storage sem 'url' na resposta: ${JSON.stringify(d)}`);
    return { url, raw: d };
}

/* ---------------------------
   Upload de uma nota (com refresh de token em 401)
   --------------------------- */
async function uploadNota(nota, tokenOrUndefined, maxAttempts = 3) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            // sempre pegar token atual (pode vir do env ou via oauth)
            const currentToken = tokenOrUndefined || await getToken();

            // Cria cliente com token atual
            const nfClient = axios.create({
                baseURL: NFSTOCK_IMP_BASE,
                headers: { Authorization: `Bearer ${currentToken}` },
                timeout: 60000
            });

            const xmlBuffer = Buffer.from(nota.xml || '', 'utf8');
            if (!xmlBuffer || xmlBuffer.length === 0) throw new Error('XML vazio para upload.');

            // 1) Solicitar presigned URL
            const { url: presignedUrl, raw: storageRaw } = await requestUploadUrlWithClient(nfClient, xmlBuffer.byteLength);
            log(`NF-Stock: /storage retornou URL (nota ${nota.chave}) -> ${presignedUrl}`);

            // 2) Upload binário sem headers extras
            log(`NF-Stock: iniciando upload para presigned URL (nota ${nota.chave})...`);
            await uploadToPresignedUrl(presignedUrl, xmlBuffer, 'PUT');

            log(`NF-Stock: Nota ${nota.chave} enviada com sucesso (tentativa ${attempt}).`);
            return true;
        } catch (e) {
            // Se for 401, tentar forçar refresh do token e tentar novamente
            const status = e.response?.status || e.statusCode || null;
            if (status === 401) {
                log(`NF-Stock: 401 recebido ao enviar nota ${nota.chave} — invalid_token. Forçando refresh de token...`);
                clearOauthCache();
                // se tem token em env (NFSTOCK_API_TOKEN), ele não será substituído — nesse caso devemos informar ao dev
                if (NFSTOCK_API_TOKEN) {
                    log('NF-Stock: atenção: NFSTOCK_API_TOKEN está configurado em env mas foi considerado inválido pelo servidor.');
                }
                // aguarda pequeno backoff antes de tentar novamente
                if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 1000 * attempt));
                continue; // próxima tentativa usará getToken() atualizado
            }

            // Log detalhado do erro
            let details = '';
            if (e.response) {
                const r = e.response;
                let body = r.data;
                try { if (typeof body === 'object') body = JSON.stringify(body, null, 2); } catch (xx) { body = String(body); }
                details = `status=${r.status} ${r.statusText} body=${body} headers=${JSON.stringify(r.headers || {}, null, 2)}`;
            } else if (e.statusCode) {
                details = `status=${e.statusCode} body=${e.body || ''} message=${e.message || ''}`;
            } else {
                details = e.message || String(e);
            }
            log(`NF-Stock: Falha ao enviar nota ${nota.chave} (tentativa ${attempt}/${maxAttempts}): ${details}`);

            if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 1000 * attempt));
        }
    }
    return false;
}

/* ---------------------------
   uploadAll - aceita token opcional (se omitido, pega via getToken)
   --------------------------- */
async function uploadAll(notas, token, concurrency = CONCURRENCY_UPLOADS) {
    // se token não foi passado, vamos obter um (env or oauth)
    const initialToken = token || await getToken();

    const processedSet = loadSet();
    const results = { sent: 0, failed: 0, skipped: 0 };
    const BATCH_SIZE = BATCH_FLUSH_SIZE || 10;

    const notesToSend = notas.filter(nota => {
        if (!nota.chave || processedSet.has(nota.chave) || !nota.xml || nota.xml.trim().length === 0) {
            results.skipped++;
            return false;
        }
        return true;
    });

    if (notesToSend.length === 0) {
        log('NF-Stock: Nenhuma nota nova para enviar.');
        return results;
    }

    log(`NF-Stock: Preparando para enviar ${notesToSend.length} novas notas (concorrência=${concurrency})...`);
    let idx = 0;
    let localSuccessCount = 0;

    async function worker() {
        while (true) {
            const i = idx++;
            if (i >= notesToSend.length) return;
            const nota = notesToSend[i];
            try {
                const ok = await uploadNota(nota, initialToken);
                if (ok) {
                    results.sent++;
                    processedSet.add(nota.chave);
                    localSuccessCount++;
                    if (localSuccessCount % BATCH_SIZE === 0) {
                        saveSet(processedSet);
                        log(`NF-Stock: Histórico salvo após ${localSuccessCount} sucessos.`);
                    }
                } else {
                    results.failed++;
                }
            } catch (e) {
                results.failed++;
                log(`NF-Stock: Erro no worker ao enviar nota ${nota.chave}: ${e.message || e}`);
            }
        }
    }

    const workers = [];
    const numWorkers = Math.min(concurrency || 1, notesToSend.length);
    for (let w = 0; w < numWorkers; w++) workers.push(worker());
    await Promise.all(workers);

    saveSet(processedSet);
    log('NF-Stock: Fila de uploads finalizada. Histórico final salvo.');
    return results;
}

module.exports = { getToken, uploadAll };
