// routes/payments.js - سقيا الحرمين | بوابات الدفع
const express = require('express');
const router = express.Router();
const { db } = require('../database/db');
const { authenticate } = require('../middleware/auth');
const { generateUUID } = require('../utils/helpers');

const PAYMENT_MODE = process.env.PAYMENT_MODE || 'sandbox';

// ═══ إنشاء Payment Intent ═══
router.post('/intent', authenticate, async (req, res) => {
  const { donation_id, amount, currency = 'SAR', gateway = 'sandbox' } = req.body;
  
  if (!donation_id || !amount) {
    return res.status(400).json({ success: false, message: 'بيانات الدفع غير مكتملة' });
  }

  if (amount <= 0 || amount > 1000000) {
    return res.status(400).json({ success: false, message: 'مبلغ غير صحيح' });
  }

  const donation = db.prepare('SELECT * FROM donations WHERE id = ?').get(donation_id);
  if (!donation) return res.status(404).json({ success: false, message: 'التبرع غير موجود' });

  // Anti-tampering: verify amount matches donation
  if (Math.abs(donation.amount - amount) > 0.01) {
    return res.status(400).json({ success: false, message: 'المبلغ لا يطابق التبرع' });
  }

  let paymentData = {};

  if (PAYMENT_MODE === 'sandbox' || gateway === 'sandbox') {
    // Sandbox mode
    const intentId = `SAGYA_SANDBOX_${generateUUID().substring(0, 8).toUpperCase()}`;
    paymentData = {
      intent_id: intentId,
      gateway: 'sandbox',
      mode: 'sandbox',
      amount,
      currency,
      checkout_url: `${process.env.APP_URL || 'https://sagya-backend.onrender.com'}/api/payments/sandbox/checkout/${intentId}`,
      note: 'وضع تجريبي - لن يتم خصم أي مبالغ'
    };
  } else if (gateway === 'moyasar') {
    // Moyasar
    try {
      const axios = require('axios');
      const response = await axios.post('https://api.moyasar.com/v1/payments', {
        amount: Math.round(amount * 100), // halalas
        currency,
        description: `تبرع سقيا الحرمين - ${donation.tracking_number}`,
        callback_url: `${process.env.APP_URL}/api/payments/webhook/moyasar`,
        source: { type: 'creditcard' }
      }, {
        auth: { username: process.env.MOYASAR_API_KEY, password: '' }
      });
      paymentData = { intent_id: response.data.id, checkout_url: response.data.source.transaction_url, gateway: 'moyasar' };
    } catch (e) {
      return res.status(500).json({ success: false, message: 'خطأ في بوابة Moyasar' });
    }
  } else if (gateway === 'stripe') {
    // Stripe
    try {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const intent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100),
        currency: currency.toLowerCase(),
        metadata: { donation_id: donation_id.toString(), tracking: donation.tracking_number }
      });
      paymentData = { intent_id: intent.id, client_secret: intent.client_secret, gateway: 'stripe' };
    } catch (e) {
      return res.status(500).json({ success: false, message: 'خطأ في بوابة Stripe' });
    }
  } else if (gateway === 'tap') {
    // Tap Payments
    try {
      const axios = require('axios');
      const response = await axios.post('https://api.tap.company/v2/charges/', {
        amount,
        currency,
        customer: { first_name: donation.donor_name, phone: { number: donation.donor_phone } },
        source: { id: 'src_all' },
        redirect: { url: `${process.env.ADMIN_URL || process.env.APP_URL}/donations` },
        post: { url: `${process.env.APP_URL}/api/payments/webhook/tap` }
      }, {
        headers: { Authorization: `Bearer ${process.env.TAP_SECRET_KEY}` }
      });
      paymentData = { intent_id: response.data.id, checkout_url: response.data.transaction?.url, gateway: 'tap' };
    } catch (e) {
      return res.status(500).json({ success: false, message: 'خطأ في بوابة Tap' });
    }
  }

  // Save payment intent
  const result = db.prepare(`
    INSERT INTO payments (donation_id, amount, currency, gateway, payment_intent, status, metadata)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(donation_id, amount, currency, paymentData.gateway, paymentData.intent_id, JSON.stringify(paymentData));

  db.prepare(`UPDATE donations SET payment_status = 'pending', payment_gateway = ? WHERE id = ?`)
    .run(paymentData.gateway, donation_id);

  res.json({ success: true, data: { payment_id: result.lastInsertRowid, ...paymentData } });
});

// ═══ Sandbox Checkout (للتطوير) ═══
router.get('/sandbox/checkout/:intent_id', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
    <head>
      <meta charset="UTF-8">
      <title>سقيا الحرمين - Sandbox Payment</title>
      <style>
        body { font-family: 'Cairo', sans-serif; background: #0B3D1E; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
        .card { background: white; border-radius: 20px; padding: 40px; text-align: center; max-width: 400px; width: 90%; }
        h2 { color: #0B3D1E; }
        .badge { background: #FFF3CD; color: #856404; padding: 8px 16px; border-radius: 8px; font-size: 12px; margin-bottom: 20px; display: inline-block; }
        .btn { background: #0B3D1E; color: white; border: none; padding: 14px 40px; border-radius: 12px; font-family: Cairo; font-size: 16px; cursor: pointer; width: 100%; margin-top: 10px; }
        .btn-danger { background: #dc3545; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="badge">⚠️ وضع الاختبار - Sandbox Mode</div>
        <h2>🕌 سقيا الحرمين</h2>
        <p>رقم العملية: <strong>${req.params.intent_id}</strong></p>
        <p>هذا وضع تجريبي - لن يتم خصم أي مبالغ حقيقية</p>
        <button class="btn" onclick="confirm('${req.params.intent_id}')">✅ تأكيد الدفع (تجريبي)</button>
        <button class="btn btn-danger" onclick="history.back()">❌ إلغاء</button>
      </div>
      <script>
        function confirm(id) {
          fetch('/api/payments/sandbox/confirm/' + id, { method: 'POST' })
            .then(r => r.json()).then(d => alert(d.message || 'تم!')).catch(() => alert('خطأ'));
        }
      </script>
    </body>
    </html>
  `);
});

// ═══ Sandbox Confirm ═══
router.post('/sandbox/confirm/:intent_id', async (req, res) => {
  const payment = db.prepare(`SELECT * FROM payments WHERE payment_intent = ?`).get(req.params.intent_id);
  if (!payment) return res.status(404).json({ success: false, message: 'العملية غير موجودة' });

  db.prepare(`UPDATE payments SET status = 'completed', updated_at = datetime('now') WHERE payment_intent = ?`).run(req.params.intent_id);
  db.prepare(`UPDATE donations SET payment_status = 'paid', status = 'received' WHERE id = ?`).run(payment.donation_id);

  res.json({ success: true, message: 'تم تأكيد الدفع (تجريبي)' });
});

// ═══ Webhooks ═══
router.post('/webhook/:gateway', async (req, res) => {
  const { gateway } = req.params;
  const payload = req.body;

  try {
    let intentId, status;

    if (gateway === 'moyasar') {
      intentId = payload.id;
      status = payload.status === 'paid' ? 'completed' : 'failed';
    } else if (gateway === 'stripe') {
      if (payload.type === 'payment_intent.succeeded') {
        intentId = payload.data?.object?.id;
        status = 'completed';
      }
    } else if (gateway === 'tap') {
      intentId = payload.id;
      status = payload.status === 'CAPTURED' ? 'completed' : 'failed';
    }

    if (intentId && status === 'completed') {
      const payment = db.prepare(`SELECT * FROM payments WHERE payment_intent = ?`).get(intentId);
      if (payment) {
        db.prepare(`UPDATE payments SET status = 'completed', webhook_received = 1, updated_at = datetime('now') WHERE payment_intent = ?`).run(intentId);
        db.prepare(`UPDATE donations SET payment_status = 'paid', status = 'received' WHERE id = ?`).run(payment.donation_id);
      }
    }

    res.json({ received: true });
  } catch (e) {
    console.error('Webhook error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ═══ قائمة المدفوعات ═══
router.get('/', authenticate, async (req, res) => {
  const payments = db.prepare(`
    SELECT p.*, d.tracking_number, d.donor_name, d.donation_type
    FROM payments p
    LEFT JOIN donations d ON p.donation_id = d.id
    ORDER BY p.created_at DESC
    LIMIT 50
  `).all();
  res.json({ success: true, data: payments });
});

module.exports = router;
