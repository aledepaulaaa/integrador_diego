// src/models/processedModel.js
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config');

const FILE = path.join(DATA_DIR, 'processed.json');
const FILE_TMP = FILE + '.tmp';

function ensureDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Carrega o arquivo processed.json e retorna um Set de chaves.
 * Sempre retorna um Set, mesmo em erro.
 */
function loadSet() {
    try {
        ensureDir();
        if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify([], null, 2), 'utf8');
        const raw = fs.readFileSync(FILE, 'utf8') || '[]';
        const arr = JSON.parse(raw);
        return new Set(Array.isArray(arr) ? arr : []);
    } catch (e) {
        console.error(`[processedModel.loadSet] erro: ${e.message}`);
        return new Set();
    }
}

/**
 * Salva um Set ou Array no arquivo processed.json de forma atômica.
 * Aceita Set, Array ou única string (chave).
 */
function saveSet(setOrArray) {
    try {
        ensureDir();
        let arr;
        if (setOrArray instanceof Set) arr = Array.from(setOrArray);
        else if (Array.isArray(setOrArray)) arr = setOrArray;
        else if (typeof setOrArray === 'string') arr = [setOrArray];
        else arr = [];

        fs.writeFileSync(FILE_TMP, JSON.stringify(arr, null, 2), 'utf8');
        fs.renameSync(FILE_TMP, FILE);
        return true;
    } catch (e) {
        console.error(`[processedModel.saveSet] erro: ${e.message}`);
        try { if (fs.existsSync(FILE_TMP)) fs.unlinkSync(FILE_TMP); } catch (_) { }
        return false;
    }
}

/**
 * Adiciona uma chave e grava imediatamente (operação conveniente).
 * Retorna true se adicionou (ou já existia).
 */
function addKey(key) {
    if (!key) return false;
    const s = loadSet();
    s.add(key);
    return saveSet(s);
}

/**
 * Verifica se a chave já foi processada.
 * (nota: carrega o arquivo cada chamada — ok para casos esporádicos)
 */
function hasKey(key) {
    if (!key) return false;
    const s = loadSet();
    return s.has(key);
}

/** Retorna todos os elementos como array (útil para API / UI) */
function getAll() {
    return Array.from(loadSet());
}

/** Tamanho do conjunto */
function size() {
    return getAll().length;
}

/** Reseta o arquivo (limpa todas as chaves) */
function reset() {
    return saveSet([]);
}

module.exports = {
    loadSet,
    saveSet,
    addKey,
    hasKey,
    getAll,
    size,
    reset
};
