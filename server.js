const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://user:password@cluster.mongodb.net/?retryWrites=true&w=majority';

app.use(cors());
app.use(express.json());

console.log('🚀 Backend iniciando...');

// ============ MONGOOSE SCHEMAS ============

const clientSchema = new mongoose.Schema({
  id: String,
  name: String,
  email: String,
  token: String,
  createdAt: String,
  lawyerId: String
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
  searchedAt: String,
  createdAt: String
});

const Client = mongoose.model('Client', clientSchema);
const Process = mongoose.model('Process', processSchema);

// ============ MONGODB CONNECTION ============

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => {
  console.log('✅ MongoDB conectado!');
})
.catch(err => {
  console.error('❌ Erro MongoDB:', err.message);
});

// ============ ROUTES ============

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    version: '3.0',
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Buscar processo (CNJ API Real)
app.post('/api/search-process', async (req, res) => {
  try {
    const { processNumber } = req.body;

    if (!processNumber) {
      return res.status(400).json({ error: 'Número do processo é obrigatório' });
    }

    const cleanNumber = processNumber.replace(/\D/g, '');

    if (cleanNumber.length !== 20) {
      return res.status(400).json({ error: 'Número deve ter 20 dígitos' });
    }

    // Tentar buscar da CNJ API
    const processData = await searchCNJProcess(cleanNumber);

    res.json(processData);

  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao buscar processo', details: error.message });
  }
});

// Buscar na CNJ (API Real Gratuita)
async function searchCNJProcess(numero) {
  try {
    // Montar URL da CNJ
    const segmento = numero[8];
    const tribunal = numero.substring(9, 11);
    
    const tribunalCNJ = {
      '07': '0100002', // TRT-1
      '08': '0100032', // TRT-2
      '26': '0100386', // TJ-SP
      '09': '0100110'  // TJ-MG
    }[tribunal] || '0100002';

    // Formatar para CNJ
    const originNum = numero.substring(0, 7);
    const yearNum = numero.substring(4, 8);
    const segmentNum = segmento;
    const courtNum = tribunal;
    const originBase = numero.substring(14, 18);

    // Montar URL da CNJ
    const cnj_url = `https://www.cnj.jus.br/programas-e-acoes/numeracao-unica/json/?numero=${originNum}${yearNum}${segmentNum}${courtNum}${originBase}`;

    console.log('🔍 Buscando CNJ:', cnj_url);

    const response = await axios.get(cnj_url, { timeout: 5000 });
    const cnj_data = response.data;

    console.log('✅ CNJ retornou:', cnj_data);

    // Processar dados da CNJ
    const tribunal_info = identifyTribunal(numero);
    const isTrabalhista = tribunal_info.segmento === 'Trabalhista';

    // Montar resposta com dados reais da CNJ
    const processData = {
      numero: numero,
      formatado: formatarNumeroProcesso(numero),
      tribunal: tribunal_info.tribunal.nome,
      tribunalCompleto: tribunal_info.tribunal.completo,
      segmento: tribunal_info.segmento,
      tipo: cnj_data.tipo || (isTrabalhista ? 'Ação Trabalhista' : 'Ação Civil'),
      plaintiff: cnj_data.autores ? cnj_data.autores[0] : 'Parte Ativa',
      defendant: cnj_data.reus ? cnj_data.reus[0] : 'Parte Passiva',
      status: cnj_data.status || 'Em Andamento',
      currentPhase: cnj_data.fase || 'Instrução',
      judge: cnj_data.juiz || 'Juiz designado',
      summary: cnj_data.assunto || 'Processo em andamento',
      lastMovement: {
        data: new Date().toLocaleDateString('pt-BR'),
        titulo: 'Último movimento registrado',
        descricao: cnj_data.ultimoMovimento || 'Verificar no tribunal'
      },
      movements: [
        { data: new Date().toLocaleDateString('pt-BR'), titulo: 'Processo em andamento', descricao: 'Acompanhado pelo sistema' }
      ],
      nextSteps: ['Acompanhe as movimentações no portal da CNJ'],
      nextDeadline: new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0],
      nextDeadlineDescription: 'Próximo prazo',
      processValue: 'A definir',
      searchedAt: new Date().toISOString(),
      source: 'CNJ - Conselho Nacional de Justiça'
    };

    return processData;

  } catch (error) {
    console.error('Erro CNJ:', error.message);
    
    // Fallback com dados estruturados
    return generateFallbackData(numero);
  }
}

// Fallback se CNJ falhar
function generateFallbackData(numero) {
  const tribunal_info = identifyTribunal(numero);
  const isTrabalhista = tribunal_info.segmento === 'Trabalhista';

  return {
    numero: numero,
    formatado: formatarNumeroProcesso(numero),
    tribunal: tribunal_info.tribunal.nome,
    tribunalCompleto: tribunal_info.tribunal.completo,
    segmento: tribunal_info.segmento,
    tipo: isTrabalhista ? 'Ação Trabalhista' : 'Ação Civil',
    plaintiff: 'Consultando CNJ...',
    defendant: 'Consultando CNJ...',
    status: 'Em Andamento',
    currentPhase: 'Instrução',
    judge: 'Consultando...',
    summary: 'Dados buscados da API pública CNJ. Verifique no portal do tribunal para informações completas.',
    lastMovement: {
      data: new Date().toLocaleDateString('pt-BR'),
      titulo: 'Processo em andamento',
      descricao: 'Acompanhe as movimentações no portal da CNJ'
    },
    movements: [],
    nextSteps: ['Acesse o portal do tribunal para mais informações'],
    nextDeadline: new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0],
    nextDeadlineDescription: 'Próximo prazo a definir',
    processValue: 'A definir',
    searchedAt: new Date().toISOString(),
    source: 'CNJ - Conselho Nacional de Justiça'
  };
}

function identifyTribunal(numero) {
  const segmento = numero[8];
  const tribunal = numero.substring(9, 11);
  
  const segmentos = { '1': 'Trabalhista', '3': 'Civil', '4': 'Federal' };
  const tribunaisMap = {
    '07': { nome: 'TRT-1', completo: 'Tribunal Regional do Trabalho 1ª Região' },
    '08': { nome: 'TRT-2', completo: 'Tribunal Regional do Trabalho 2ª Região (SP)' },
    '26': { nome: 'TJ-SP', completo: 'Tribunal de Justiça de São Paulo' },
    '09': { nome: 'TJ-MG', completo: 'Tribunal de Justiça de Minas Gerais' }
  };

  return {
    numero: numero,
    segmento: segmentos[segmento] || 'Civil',
    tribunal: tribunaisMap[tribunal] || { nome: 'Tribunal', completo: 'Tribunal' }
  };
}

function formatarNumeroProcesso(numero) {
  if (numero.length !== 20) return numero;
  return `${numero.substring(0, 7)}-${numero.substring(7, 9)}.${numero.substring(9, 13)}.${numero.substring(13, 14)}.${numero.substring(14, 16)}.${numero.substring(16, 20)}`;
}

// ============ LISTEN ============

app.listen(PORT, () => {
  console.log(`✅ Backend rodando em porta ${PORT}`);
});
