// src/models/cnpjModel.js
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config');
const FILE = path.join(DATA_DIR, 'cnpjs.json');

function ensureDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadAll() {
    try {
        ensureDir();
        if (!fs.existsSync(FILE)) { fs.writeFileSync(FILE, JSON.stringify([], null, 2)); return []; }
        const raw = fs.readFileSync(FILE, 'utf8');
        return JSON.parse(raw || '[]');
    } catch (e) {
        console.error('cnpjModel.loadAll error', e.message);
        return [];
    }
}

function saveAll(list) {
    ensureDir();
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(list, null, 2), 'utf8');
    fs.renameSync(FILE + '.tmp', FILE);
}

function addCnpj(cnpj) {
    const list = loadAll();
    const clean = ('' + cnpj).replace(/\D/g, '');
    if (!/^\d{14}$/.test(clean) && !/^\d{11}$/.test(clean)) throw new Error('CNPJ/CPF inválido');
    if (list.find(x => x.cnpj === clean)) return null; // Retorna nulo se já existe
    const now = new Date().toISOString();
    const item = {
        cnpj: clean,
        dateCreated: now,
        dateUpdated: now,
        lastChecked: null,
        lastResult: null,
        processCount: 0, // Contador de tentativas
        lastError: null // Último erro registrado
    };
    list.push(item);
    saveAll(list);
    return item;
}

function updateChecked(cnpj, lastCheckedISO, lastResult) {
    const list = loadAll();
    const idx = list.findIndex(x => x.cnpj === cnpj);
    if (idx === -1) return false;
    list[idx].lastChecked = lastCheckedISO;
    list[idx].lastResult = lastResult;
    list[idx].dateUpdated = new Date().toISOString();
    list[idx].lastError = null; // Limpa o erro em caso de sucesso
    list[idx].processCount = 0; // Zera o contador de tentativas em caso de sucesso
    saveAll(list);
    return true;
}

// NOVO: Atualiza o CNPJ com uma mensagem de erro
function updateError(cnpj, errorMessage) {
    const list = loadAll();
    const idx = list.findIndex(x => x.cnpj === cnpj);
    if (idx === -1) return false;
    list[idx].lastError = errorMessage;
    list[idx].dateUpdated = new Date().toISOString();
    saveAll(list);
    return true;
}

// NOVO: Incrementa o contador de tentativas de processamento
function incrementProcessCount(cnpj) {
    const list = loadAll();
    const idx = list.findIndex(x => x.cnpj === cnpj);
    if (idx === -1) return false;
    list[idx].processCount = (list[idx].processCount || 0) + 1;
    saveAll(list);
    return true;
}

// NOVO: Deleta um único CNPJ
function deleteCnpj(cnpj) {
    let list = loadAll();
    const initialLength = list.length;
    list = list.filter(x => x.cnpj !== cnpj);
    if (list.length === initialLength) throw new Error('CNPJ não encontrado');
    saveAll(list);
    return true;
}

// NOVO: Deleta múltiplos CNPJs
function deleteMultipleCnpjs(cnpjs) {
    let list = loadAll();
    const cnpjsToDelete = new Set(cnpjs);
    list = list.filter(x => !cnpjsToDelete.has(x.cnpj));
    saveAll(list);
    return true;
}


module.exports = {
    loadAll,
    addCnpj,
    saveAll,
    updateChecked,
    updateError,
    incrementProcessCount,
    deleteCnpj,
    deleteMultipleCnpjs
};