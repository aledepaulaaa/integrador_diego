// src/models/statusModel.js
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config');
const FILE = path.join(DATA_DIR, 'status.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }

function loadStatus() {
    try {
        ensureDir();
        if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify({ lastRun: null, summary: null }, null, 2));
        return JSON.parse(fs.readFileSync(FILE, 'utf8') || '{}');
    } catch (e) {
        console.error('statusModel.load', e.message);
        return { lastRun: null, summary: null };
    }
}

function saveStatus(obj) {
    try {
        ensureDir();
        fs.writeFileSync(FILE, JSON.stringify(obj, null, 2));
        return true;
    } catch (e) {
        console.error('statusModel.save', e.message);
        return false;
    }
}

module.exports = { loadStatus, saveStatus };
