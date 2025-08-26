// src/services/nfstockService.js
const axios = require('axios');
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
    if (NFSTOCK_API_TOKEN) return NFSTOCK_API_TOKEN;
    if (oauthTokenCache && oauthTokenCache.expiresAt > Date.now()) return oauthTokenCache.token;
    return await obtainTokenViaClientCredentials();
}

async function uploadNota(nota, token, maxAttempts = 3) {
    const nfClient = axios.create({
        baseURL: NFSTOCK_IMP_BASE,
        headers: { Authorization: `Bearer ${token}` },
        timeout: 60000
    });

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            // Passo 1: Obter a URL de upload pré-assinada
            const xmlBuffer = Buffer.from(nota.xml, 'utf8');
            const tamanho = xmlBuffer.byteLength;

            // A API da NF-Stock pode estar esperando o Content-Type na requisição POST.
            // A documentação pode estar incompleta. Vamos incluir.
            const storageResponse = await nfClient.post('/storage', { size: tamanho, extension: '.xml', contentType: 'application/xml' });
            const uploadUrl = storageResponse.data?.url;
            console.log("URL Pré Assinada: ", uploadUrl);
            if (!uploadUrl) throw new Error('API /storage não retornou uma URL de upload válida.');

            // Passo 2: Enviar o arquivo para a URL pré-assinada usando axios
            // **Este é o ponto crucial: use o axios.put e especifique o Content-Type.**
            await axios.put(uploadUrl, xmlBuffer, {
                headers: {
                    'Content-Type': 'application/xml'
                },
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
                timeout: 60000
            });

            log(`NF-Stock: Nota ${nota.chave} enviada com sucesso (tentativa ${attempt}).`);
            return true;
        } catch (e) {
            const errorMessage = e.response?.data || e.message;
            log(`NF-Stock: Falha ao enviar nota ${nota.chave} (tentativa ${attempt}/${maxAttempts}): ${errorMessage}`);
            if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 1000 * attempt));
        }
    }
    return false;
}

async function uploadAll(notas, token, concurrency = CONCURRENCY_UPLOADS) {
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

    log(`NF-Stock: Preparando para enviar ${notesToSend.length} novas notas (concorrência=${CONCURRENCY_UPLOADS})...`);
    let idx = 0;
    let localSuccessCount = 0;
    async function worker() {
        while (true) {
            const i = idx++;
            if (i >= notesToSend.length) return;
            const nota = notesToSend[i];
            try {
                const ok = await uploadNota(nota, token);
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
                log(`NF-Stock: Erro no worker ao enviar nota ${nota.chave}: ${e.message}`);
            }
        }
    }
    const workers = [];
    const numWorkers = Math.min(CONCURRENCY_UPLOADS, notesToSend.length);
    for (let w = 0; w < numWorkers; w++) {
        workers.push(worker());
    }
    await Promise.all(workers);
    saveSet(processedSet);
    log('NF-Stock: Fila de uploads finalizada. Histórico final salvo.');
    return results;
}

module.exports = { getToken, uploadAll };
