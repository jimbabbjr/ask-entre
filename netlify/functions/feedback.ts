import type { Handler } from '@netlify/functions';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Use POST' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    // Expect: { good: boolean, why?: string, question?: string, answer?: string, ts?: string }
    console.log('FEEDBACK', {
      ts: body.ts || new Date().toISOString(),
      good: !!body.good,
      why: (body.why || '').toString().slice(0, 500),
      question: (body.question || '').toString().slice(0, 500),
      answer: (body.answer || '').toString().slice(0, 1000),
      ua: event.headers['user-agent'] || '',
    });
    return { statusCode: 204, body: '' };
  } catch (e) {
    console.error('FEEDBACK_ERROR', e);
    return { statusCode: 400, body: 'Bad JSON' };
  }
};
