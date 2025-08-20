import type { Handler, HandlerEvent } from '@netlify/functions';
import { connectLambda, getStore } from '@netlify/blobs';

export const handler: Handler = async (event: HandlerEvent) => {
  // 👇 satisfy TS — runtime is fine
  connectLambda(event as any);

  try {
    const body = JSON.parse(event.body || '{}');
    const ts = body.ts || new Date().toISOString();

    const entry = {
      ts,
      good: !!body.good,
      why: (body.why || '').toString().slice(0, 500),
      question: (body.question || '').toString().slice(0, 500),
      answer: (body.answer || '').toString().slice(0, 1200),
      ua: event.headers['user-agent'] || '',
    };

    const store = getStore('logs');
    const key = `feedback/${ts.slice(0,10)}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.json`;
    await store.setJSON(key, entry);
    console.log('FEEDBACK', entry);

    return { statusCode: 204, body: '' };
  } catch (e) {
    console.error('FEEDBACK_ERROR', e);
    return { statusCode: 400, body: 'Bad JSON' };
  }
};
