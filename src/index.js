// src/index.js
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const config = require('./config');
const siegService = require('./services/siegService');
const nfService = require('./services/nfstockService');
const cnpjModel = require('./models/cnpjModel');
const statusModel = require('./models/statusModel');
const apiController = require('./controllers/apiController');

const app = express();
app.use(bodyParser.json());
app.use('/public', express.static(path.join(__dirname, 'views', 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));

app.use('/api', apiController.router);

function simpleLog(m) { console.log(`[${new Date().toLocaleString('pt-BR')}] ${m}`); }

async function processCnpjEntry(entry, dateRange) {
    const { cnpj } = entry;
    simpleLog(`Processando CNPJ ${cnpj}...`);
    apiController.setState({ currentCnpj: cnpj, statusMessage: `Contando notas para ${cnpj}...`, isProcessing: true });

    try {
        const startISO = new Date(dateRange.startDate).toISOString();
        const endISO = new Date(dateRange.endDate + 'T23:59:59.999Z').toISOString();

        const totalNotasContadas = await siegService.contarNotas({ cnpj, startISO, endISO });

        apiController.setState({ statusMessage: `Total encontrado ${totalNotasContadas} notas para ${cnpj}.` });

        if (totalNotasContadas === 0) {
            simpleLog(`Nenhuma nota nova encontrada para ${cnpj} no período.`);
            cnpjModel.updateChecked(cnpj, new Date().toISOString(), { found: 0 });
            return { total: 0, sent: 0, failed: 0, skipped: 0 };
        }

        apiController.setState({ statusMessage: `Baixando ${totalNotasContadas} notas para ${cnpj}...` });

        const notasBaixadas = await siegService.baixarNotas({ cnpj, startISO, endISO, total: totalNotasContadas });

        cnpjModel.updateChecked(cnpj, new Date().toISOString(), { found: notasBaixadas.length });
        apiController.setState({ statusMessage: `Baixadas ${notasBaixadas.length} de ${totalNotasContadas} notas para ${cnpj}.` });
        apiController.setState({ statusMessage: `Enviando ${notasBaixadas.length} notas para NF-Stock...` });
        const token = await nfService.getToken();
        const envioResultado = await nfService.uploadAll(notasBaixadas, token);

        simpleLog(`CNPJ ${cnpj} finalizado. Contadas: ${totalNotasContadas}, Baixadas: ${notasBaixadas.length}, Enviadas: ${envioResultado.sent}, Falhas: ${envioResultado.failed}, Puladas: ${envioResultado.skipped}`);
        apiController.setState({ statusMessage: `Finalizado envio para ${cnpj}: ${envioResultado.sent} enviados, ${envioResultado.failed} falhas.` });

        return {
            total: totalNotasContadas,
            sent: envioResultado.sent,
            failed: envioResultado.failed,
            skipped: envioResultado.skipped + (totalNotasContadas - notasBaixadas.length)
        };

    } catch (error) {
        simpleLog(`Erro crítico ao processar CNPJ ${cnpj}: ${error.message}`);
        cnpjModel.updateError(cnpj, error.message);
        cnpjModel.incrementProcessCount(cnpj);
        apiController.setState({ statusMessage: `Erro ao processar ${cnpj}: ${error.message}` });
        throw error;
    }
}

// O resto do arquivo (rotinaCompleta, app.listen, etc.) permanece exatamente o mesmo.
async function rotinaCompleta(cnpjsToProcess, dateRange) {
    const state = apiController.getState();
    if (state.isProcessing) {
        simpleLog('Rotina já em andamento. Nova execução ignorada.');
        return;
    }

    if (!cnpjsToProcess || !dateRange) {
        simpleLog('Tentativa de iniciar rotina sem parâmetros. Ignorando.');
        return;
    }

    apiController.setState({ isProcessing: true, statusMessage: 'Iniciando rotina de integração...', progress: 0 });
    simpleLog('================ INICIANDO ROTINA DE INTEGRAÇÃO ================');

    const cnpjs = cnpjModel.loadAll().filter(c => cnpjsToProcess.includes(c.cnpj));
    if (cnpjs.length === 0) {
        simpleLog('Nenhum dos CNPJs selecionados foi encontrado na lista. Finalizando rotina.');
        apiController.setState({ isProcessing: false, statusMessage: 'Ocioso. Nenhum CNPJ válido selecionado.' });
        return;
    }

    const globalSummary = { found: 0, sent: 0, failed: 0, skipped: 0, processedCnpjs: 0 };
    let cnpjsComFalha = 0;

    for (let i = 0; i < cnpjs.length; i++) {
        const entry = cnpjs[i];
        apiController.setState({ currentCnpj: entry.cnpj, statusMessage: `Processando ${entry.cnpj} (${i + 1}/${cnpjs.length})` });

        if ((entry.processCount || 0) >= 3) {
            simpleLog(`CNPJ ${entry.cnpj} pulado devido a falhas repetidas.`);
            globalSummary.skipped += (entry.lastResult?.found || 0);
            cnpjsComFalha++;
            continue;
        }

        try {
            const r = await processCnpjEntry(entry, dateRange);
            globalSummary.found += r.total || 0;
            globalSummary.sent += r.sent || 0;
            globalSummary.failed += r.failed || 0;
            globalSummary.skipped += r.skipped || 0;
        } catch (e) {
            cnpjsComFalha++;
            simpleLog(`Erro no processamento do CNPJ ${entry.cnpj}: ${e.message}`);
        }

        globalSummary.processedCnpjs++;
        apiController.setState({ progress: Math.round(((i + 1) / cnpjs.length) * 100) });
    }

    const statusObj = { lastRun: new Date().toISOString(), summary: globalSummary };
    statusModel.saveStatus(statusObj);

    simpleLog(`Resumo: ${JSON.stringify(globalSummary)}`);
    simpleLog('================ ROTINA FINALIZADA ================');

    apiController.setState({
        isProcessing: false,
        progress: 0,
        currentCnpj: '',
        statusMessage: cnpjsComFalha > 0 ? `Finalizada com ${cnpjsComFalha} CNPJ(s) com erro.` : 'Finalizada com sucesso.'
    });
}

module.exports.triggerRotina = rotinaCompleta;

app.listen(config.PORT, () => {
    simpleLog(`Servidor iniciado na porta ${config.PORT}`);
    simpleLog('Aguardando ações do usuário para iniciar o processamento.');
});