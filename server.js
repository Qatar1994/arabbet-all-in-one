import express from 'express';
import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'public')));

const isLive = (process.env.PRAXIS_ENV || 'sandbox') === 'live';
const ENDPOINT = isLive
  ? 'https://gw.praxisgate.com/cashier/cashier'
  : 'https://pci-gw-test.praxispay.com/cashier/cashier';

const FRONTEND_BASE = process.env.FRONTEND_BASE || 'http://localhost:3000';

const ordersStore = new Map();

function signPayload(body){
  const concat =
    (body.merchant_id ?? '') +
    (body.application_key ?? '') +
    (body.timestamp ?? '') +
    (body.intent ?? '') +
    (body.cid ?? '') +
    (body.order_id ?? '') +
    (process.env.PRAXIS_SECRET ?? '');
  return crypto.createHash('sha384').update(concat).digest('hex');
}

app.post('/api/praxis/init', async (req, res)=>{
  try{
    const { amount, currency='USD', cid='user_demo', locale='ar-QA' } = req.body || {};
    if(!amount || Number(amount) <= 0){
      return res.status(400).json({ ok:false, error:'amount_required' });
    }
    const payload = {
      merchant_id: process.env.PRAXIS_MERCHANT_ID,
      application_key: process.env.PRAXIS_APP_KEY,
      intent: 'payment',
      currency,
      amount: Math.round(Number(amount) * 100),
      cid,
      locale,
      notification_url: FRONTEND_BASE + '/api/praxis/webhook',
      return_url: FRONTEND_BASE + '/result.html',
      order_id: 'ord_' + Date.now(),
      version: '1.3',
      timestamp: Math.floor(Date.now()/1000)
    };
    const signature = signPayload(payload);

    ordersStore.set(payload.order_id, {
      order_id: payload.order_id,
      amount: payload.amount,
      currency: payload.currency,
      status: 'pending',
      timestamp: payload.timestamp,
      cid: payload.cid
    });

    const resp = await fetch(ENDPOINT, {
      method:'POST',
      headers:{
        'Content-Type':'application/json; charset=utf-8',
        'Gt-Authentication': signature
      },
      body: JSON.stringify(payload)
    });

    const data = await resp.json().catch(()=> ({}));
    if(!resp.ok || !data?.redirect_url){
      return res.status(400).json({ ok:false, error: data?.description || 'gateway_error', raw:data });
    }
    return res.json({ ok:true, redirect_url: data.redirect_url, raw: data });
  }catch(err){
    return res.status(500).json({ ok:false, error: err.message });
  }
});

app.get('/api/history', (req, res)=>{
  const cid = req.query.cid || 'user_demo';
  const orders = [];
  for(const o of ordersStore.values()){
    if(o.cid === cid){ orders.push(o); }
  }
  orders.sort((a,b)=> b.timestamp - a.timestamp);
  res.json({ ok:true, orders });
});

app.post('/api/praxis/webhook', (req, res)=>{
  try{
    const body = req.body || {};
    if(body.order_id && ordersStore.has(body.order_id)){
      const o = ordersStore.get(body.order_id);
      if(body.status) o.status = body.status;
      if(body.amount) o.amount = body.amount;
      if(body.currency) o.currency = body.currency;
      ordersStore.set(body.order_id, o);
    }
  }catch(e){}
  res.status(200).json({ ok:true });
});

app.get('*', (req, res)=>{
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, ()=> console.log('Arabbet all-in-one running on http://localhost:' + port));
