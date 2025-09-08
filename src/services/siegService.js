// src/services/siegService.js
const axios = require('axios');
const { SIEG_API_BASE, SIEG_API_KEY, SIEG_PAGE_SIZE } = require('../config');
const { Buffer } = require('buffer');

const apiKey = SIEG_API_KEY;
const client = axios.create({
    baseURL: SIEG_API_BASE,
    headers: { 'Content-Type': 'application/json' },
    timeout: 120000 // 2 minutos
});

function log(msg) { console.log(`[${new Date().toLocaleString('pt-BR')}] ${msg}`); }

async function post(path, payload) {
    const url = `${path}?api_key=${apiKey}`;
    log(`SIEG POST ${path}`);
    return client.post(url, payload);
}

async function contarNotas({ cnpj, startISO, endISO }) {
    const payload = {
        CnpjDest: cnpj,
        DataEmissaoInicio: startISO,
        DataEmissaoFim: endISO,
        DataUploadInicio: startISO,
        DataUploadFim: endISO
    };
    const response = await post('/ContarXmls', payload);
    const data = response.data || {};
    const total = (data.NFe || 0) + (data.NFCe || 0) + (data.CTe || 0) + (data.CFe || 0) + (data.NFSe || 0);
    log(`Contagem para ${cnpj}: ${total} notas encontradas no período.`);
    return total;
}

async function baixarNotas({ cnpj, startISO, endISO, total }) {
    if (total === 0) return [];

    const allXmls = [];
    const pages = Math.ceil(total / SIEG_PAGE_SIZE);
    log(`Iniciando download de ${total} notas em ${pages} página(s)...`);

    for (let p = 0; p < pages; p++) {
        const skip = p * SIEG_PAGE_SIZE;
        const take = Math.min(SIEG_PAGE_SIZE, total - skip);

        const payload = {
            XmlType: 1,
            Take: take,
            Skip: skip,
            DataEmissaoInicio: startISO,
            DataEmissaoFim: endISO,
            CnpjDest: cnpj,
            Downloadevent: false
        };

        try {
            log(`Buscando página ${p + 1}/${pages} (take=${take}, skip=${skip})...`);
            const response = await post('/BaixarXmls', payload);

            // CORREÇÃO FINAL E DEFINITIVA: A resposta é um objeto com uma propriedade "data"
            // que é uma STRING contendo um JSON array. Precisamos fazer o parse.
            let xmlsBase64 = [];
            if (response.data && typeof response.data === 'string') {
                try {
                    // Tenta fazer o parse da string para um array
                    xmlsBase64 = JSON.parse(response.data);
                } catch (e) {
                    log('Aviso: A resposta da SIEGE não é um JSON válido.');
                }
            }

            if (!Array.isArray(xmlsBase64)) {
                log('Aviso: Após o parse, a resposta da SIEGE não é um array.');
                xmlsBase64 = [];
            }

            if (xmlsBase64.length > 0) {
                log(`Página ${p + 1} baixada com sucesso, ${xmlsBase64.length} XML(s) recebido(s).`);
            }

            for (const base64String of xmlsBase64) {
                let xmlDecoded = '', chave = null;
                try {
                    xmlDecoded = Buffer.from(base64String || '', 'base64').toString('utf8');
                    if (xmlDecoded) {
                        const match = xmlDecoded.match(/<chNFe>(\d{44})<\/chNFe>|<infNFe\s+Id="NFe(\d{44})"/);
                        if (match) chave = match[1] || match[2];
                        allXmls.push({ chave: chave, xml: xmlDecoded });
                        log(`Nota baixada com sucesso: ${chave}`);
                    }
                } catch (e) {
                    log(`Aviso: Falha ao decodificar ou processar uma string Base64.`);
                }
            }
        } catch (err) {
            const errorMessage = err.response?.data?.[0] || err.response?.data?.Message || err.message;
            log(`Falha ao baixar a página ${p + 1}. Erro: ${errorMessage}`);
        }
    }
    return allXmls;
}

module.exports = { contarNotas, baixarNotas };