const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://user:password@cluster.mongodb.net/?retryWrites=true&w=majority';

// ============ CORS ============
app.use(cors());
app.use(express.json());

console.log('🚀 Backend iniciando...');

// ============ SCHEMAS ============
const clientSchema = new mongoose.Schema({
  id: String,
  name: String,
  email: String,
  token: String,
  createdAt: String
});

const processSchema = new mongoose.Schema({
  id: String,
  clientId: String,
  numero: String,
  formatado: String,
  tribunal: String,
  tribunalCompleto: String,
  segmento: String,
  tipo: String,
  plaintiff: String,
  defendant: String,
  status: String,
  currentPhase: String,
  judge: String,
  summary: String,
  lastMovement: Object,
  movements: Array,
  nextSteps: Array,
  nextDeadline: String,
  nextDeadlineDescription: String,
  processValue: String,
  advogadoNotes: String,
  searchedAt: String,
  createdAt: String
});

const Client = mongoose.model('Client', clientSchema);
const Process = mongoose.model('Process', processSchema);

// ============ CONECTAR MONGODB ============
mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ MongoDB conectado'))
  .catch((err) => {
    console.error('❌ MongoDB erro:', err.message);
  });

// ============ HEALTH ============
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    version: '5.0',
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// ============ BUSCAR PROCESSO ============
app.post('/api/search-process', async (req, res) => {
  try {
    const { processNumber } = req.body;

    if (!processNumber) {
      return res.status(400).json({ error: 'Número do processo é obrigatório' });
    }

    console.log('📋 Buscando:', processNumber);

    const processData = await searchCNJProcess(processNumber);
    res.json(processData);
  } catch (error) {
    console.error('❌ Erro:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============ BUSCAR NA CNJ ============
async function searchCNJProcess(numero) {
  try {
    // Limpar número
    let cleanNumber = numero.replace(/\D/g, '');
    
    if (cleanNumber.length !== 20) {
      throw new Error('Número deve ter 20 dígitos');
    }

    // URL da CNJ
    const cnj_url = `https://www.cnj.jus.br/programas-e-acoes/numeracao-unica/json/?numero=${cleanNumber}`;

    console.log('🔍 CNJ:', cnj_url);

    const response = await axios.get(cnj_url, { timeout: 8000 });
    const cnj_data = response.data || {};

    console.log('✅ CNJ OK');

    // Processar
    const tribunal_info = identifyTribunal(numero);

    const processData = {
      numero: numero,
      formatado: formatarNumeroProcesso(numero),
      tribunal: tribunal_info.tribunal.nome,
      tribunalCompleto: tribunal_info.tribunal.completo,
      segmento: tribunal_info.segmento,
      tipo: cnj_data.tipo || 'Ação Judicial',
      plaintiff: cnj_data.autores ? cnj_data.autores[0] : 'Consultando...',
      defendant: cnj_data.reus ? cnj_data.reus[0] : 'Consultando...',
      status: cnj_data.status || 'Em Andamento',
      currentPhase: extractPhase(cnj_data),
      judge: cnj_data.juiz || 'A definir',
      summary: cnj_data.assunto || 'Dados da API pública do CNJ',
      lastMovement: extractLastMovement(cnj_data),
      movements: extractMovements(cnj_data),
      nextSteps: generateNextSteps(cnj_data),
      nextDeadline: extractNextDeadline(cnj_data),
      nextDeadlineDescription: 'Prazo a definir',
      processValue: cnj_data.valor_causa || 'Não informado',
      searchedAt: new Date().toISOString()
    };

    return processData;
  } catch (error) {
    console.error('❌ CNJ erro:', error.message);
    throw new Error(`Erro ao buscar na CNJ: ${error.message}`);
  }
}

// ============ FUNÇÕES AUXILIARES ============

function formatarNumeroProcesso(numero) {
  if (!numero || numero.length !== 20) return numero;
  return `${numero.substring(0, 7)}-${numero.substring(7, 9)}.${numero.substring(9, 13)}.${numero.substring(13, 14)}.${numero.substring(14, 16)}.${numero.substring(16, 20)}`;
}

function identifyTribunal(numero) {
  const tribunal_code = numero.substring(9, 11);
  const segmento_code = numero[8];

  const tribunals = {
    '07': { nome: 'TRT-1', completo: 'Tribunal Regional do Trabalho - 1ª Região' },
    '08': { nome: 'TRT-2', completo: 'Tribunal Regional do Trabalho - 2ª Região' },
    '26': { nome: 'TJ-SP', completo: 'Tribunal de Justiça do Estado de São Paulo' },
    '09': { nome: 'TJ-MG', completo: 'Tribunal de Justiça do Estado de Minas Gerais' }
  };

  const segmentos = {
    '1': 'Cível',
    '2': 'Penal',
    '3': 'Trabalhista',
    '4': 'Eleitoral',
    '5': 'Militar'
  };

  return {
    tribunal: tribunals[tribunal_code] || { nome: 'Tribunal', completo: 'Tribunal Federal' },
    segmento: segmentos[segmento_code] || 'Cível'
  };
}

function extractPhase(cnj_data) {
  const status = (cnj_data.status || '').toLowerCase();
  if (status.includes('sentença')) return 'Sentença';
  if (status.includes('recurso')) return 'Recurso';
  if (status.includes('execução')) return 'Execução';
  return 'Em Andamento';
}

function extractLastMovement(cnj_data) {
  if (cnj_data.movimentacoes && Array.isArray(cnj_data.movimentacoes) && cnj_data.movimentacoes.length > 0) {
    const lastMov = cnj_data.movimentacoes[0];
    return {
      titulo: lastMov.titulo || 'Movimentação',
      descricao: lastMov.descricao || '',
      data: lastMov.data || new Date().toLocaleDateString('pt-BR')
    };
  }
  return null;
}

function extractMovements(cnj_data) {
  if (cnj_data.movimentacoes && Array.isArray(cnj_data.movimentacoes)) {
    return cnj_data.movimentacoes.map(m => ({
      titulo: m.titulo || '',
      descricao: m.descricao || '',
      data: m.data || ''
    }));
  }
  return [];
}

function extractNextDeadline(cnj_data) {
  if (cnj_data.proximo_prazo) {
    return cnj_data.proximo_prazo;
  }
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 30);
  return futureDate.toISOString();
}

function generateNextSteps(cnj_data) {
  const steps = [];
  
  if (cnj_data.status) {
    if (cnj_data.status.includes('Distribuição')) {
      steps.push('Aguardando designação de magistrado');
      steps.push('Análise da petição inicial');
    } else if (cnj_data.status.includes('Andamento')) {
      steps.push('Acompanhar movimentações');
      steps.push('Cumprir prazos estabelecidos');
    }
  }

  if (steps.length === 0) {
    steps.push('Consulte o tribunal para próximos passos');
  }

  return steps;
}

// ============ LISTEN ============
app.listen(PORT, () => {
  console.log(`✅ Backend rodando na porta ${PORT}`);
});
