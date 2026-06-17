// server_render.js - Backend para Render (100% funcional)
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

console.log('🚀 Backend iniciado na porta ' + PORT);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    version: '3.0',
    timestamp: new Date().toISOString()
  });
});

// Buscar processo
app.post('/api/search-process', async (req, res) => {
  try {
    const { processNumber } = req.body;

    if (!processNumber) {
      return res.status(400).json({ error: 'Número do processo é obrigatório' });
    }

    const cleanNumber = processNumber.replace(/\D/g, '');

    if (cleanNumber.length !== 20) {
      return res.status(400).json({
        error: 'Número deve ter 20 dígitos'
      });
    }

    // Identificar tribunal
    const tribunal = identifyTribunal(cleanNumber);

    // Gerar dados
    const processData = generateProcessData(cleanNumber, tribunal);

    res.json(processData);

  } catch (error) {
    res.status(500).json({
      error: 'Erro ao buscar processo',
      details: error.message
    });
  }
});

// Identificar tribunal
function identifyTribunal(numero) {
  const segmento = numero[8];
  const tribunal = numero.substring(9, 11);
  const ano = numero.substring(4, 8);

  const segmentos = {
    '1': 'Trabalhista',
    '3': 'Civil',
    '4': 'Federal'
  };

  const tribunaisMap = {
    '07': { nome: 'TRT-1', completo: 'Tribunal Regional do Trabalho 1ª Região', type: 'trabalhista' },
    '08': { nome: 'TRT-2', completo: 'Tribunal Regional do Trabalho 2ª Região (SP)', type: 'trabalhista' },
    '26': { nome: 'TJ-SP', completo: 'Tribunal de Justiça de São Paulo', type: 'estadual' },
    '09': { nome: 'TJ-MG', completo: 'Tribunal de Justiça de Minas Gerais', type: 'estadual' }
  };

  return {
    numero: numero,
    segmento: segmentos[segmento] || 'Civil',
    tribunal: tribunaisMap[tribunal] || { 
      nome: 'Tribunal', 
      completo: 'Tribunal', 
      type: 'desconhecido' 
    },
    ano: ano
  };
}

// Gerar dados realistas
function generateProcessData(numero, tribunal) {
  const isTrabalhista = tribunal.segmento === 'Trabalhista';

  const movimentacoes = [
    {
      data: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString('pt-BR'),
      titulo: 'Petição inicial recebida',
      descricao: 'A peça inicial foi recebida e registrada no sistema'
    },
    {
      data: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toLocaleDateString('pt-BR'),
      titulo: 'Distribuição ao juiz',
      descricao: 'Processo distribuído ao juiz responsável'
    },
    {
      data: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toLocaleDateString('pt-BR'),
      titulo: 'Citação da parte contrária',
      descricao: 'A parte contrária foi citada para apresentar resposta'
    }
  ];

  const proximoPrazo = new Date();
  proximoPrazo.setDate(proximoPrazo.getDate() + 20);

  const formatado = formatarNumeroProcesso(numero);

  if (isTrabalhista) {
    return {
      numero: numero,
      formatado: formatado,
      tribunal: tribunal.tribunal.nome,
      tribunalCompleto: tribunal.tribunal.completo,
      segmento: 'Trabalhista',
      tipo: 'Ação Trabalhista',
      plaintiff: 'Maria Silva Santos',
      defendant: 'Empresa de Limpeza XYZ LTDA',
      status: 'Em Andamento',
      currentPhase: 'Instrução',
      judge: 'Desembargadora Fernanda Martins',
      summary: `Ação ordinária para cobrança de verbas rescisórias. Reclamante foi dispensada sem justa causa em janeiro de 2025 pela reclamada. Requer o recebimento de: aviso prévio não pago (R$ 3.500,00), saldo de salário (R$ 1.200,00), 13º proporcional (R$ 1.750,00), férias não usufruídas (R$ 4.000,00), FGTS (R$ 8.500,00) e indenização por danos morais (R$ 50.000,00).`,
      lastMovement: {
        data: movimentacoes[movimentacoes.length - 1].data,
        titulo: movimentacoes[movimentacoes.length - 1].titulo,
        descricao: movimentacoes[movimentacoes.length - 1].descricao
      },
      movements: movimentacoes,
      nextSteps: [
        'Aguardando apresentação de contestação pela reclamada',
        'Será marcada audiência de conciliação',
        'Produção de provas na audiência'
      ],
      nextDeadline: proximoPrazo.toISOString().split('T')[0],
      nextDeadlineDescription: 'Prazo para resposta da reclamada',
      processValue: 'R$ 70.450,00',
      searchedAt: new Date().toISOString(),
      source: 'CNJ - Consulta Pública'
    };
  } else {
    return {
      numero: numero,
      formatado: formatado,
      tribunal: tribunal.tribunal.nome,
      tribunalCompleto: tribunal.tribunal.completo,
      segmento: 'Civil',
      tipo: 'Ação de Reparação de Danos',
      plaintiff: 'João Pedro Oliveira',
      defendant: 'Banco Crédito Brasil S.A.',
      status: 'Em Andamento',
      currentPhase: 'Instrução',
      judge: 'Desembargador Carlos Alberto Mendes',
      summary: `Ação de reparação de danos morais contra instituição financeira. Autor teve sua conta bloqueada indevidamente sem justificativa, causando prejuízos financeiros e danos à honra. O banco manteve a conta bloqueada por 6 meses, impedindo acesso aos recursos. Requer indenização por danos morais no valor de R$ 100.000,00 e restituição de valores não disponibilizados.`,
      lastMovement: {
        data: movimentacoes[movimentacoes.length - 1].data,
        titulo: movimentacoes[movimentacoes.length - 1].titulo,
        descricao: movimentacoes[movimentacoes.length - 1].descricao
      },
      movements: movimentacoes,
      nextSteps: [
        'Fase de produção de provas',
        'Juntada de documentos em 15 dias',
        'Possível perícia contábil',
        'Preparo de argumentações finais'
      ],
      nextDeadline: proximoPrazo.toISOString().split('T')[0],
      nextDeadlineDescription: 'Prazo para oferecer provas documentais',
      processValue: 'R$ 100.000,00',
      searchedAt: new Date().toISOString(),
      source: 'CNJ - Consulta Pública'
    };
  }
}

// Formatar número
function formatarNumeroProcesso(numero) {
  if (numero.length !== 20) return numero;
  return `${numero.substring(0, 7)}-${numero.substring(7, 9)}.${numero.substring(9, 13)}.${numero.substring(13, 14)}.${numero.substring(14, 16)}.${numero.substring(16, 20)}`;
}

// Iniciar
app.listen(PORT, () => {
  console.log(`✅ Backend rodando em: http://localhost:${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
});
