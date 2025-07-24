// const chatHandler = require('./chatHandler');

// async function runTests() {
//   const tests = [
//     { q: 'How much for 2 containers?', expect: 'That’s ¥200 CTN fee + ¥200 service fee.' },
//     { q: 'What are your payment methods?', expect: 'We accept bank transfer, Stripe, and Allinpay.' },
//     { q: 'Can you resend invoice for BL12345?', expect: 'Here’s your invoice:' },
//     { q: 'I paid already, here’s receipt.', expect: 'Please provide your BL number' },
//     { q: 'BL12345, here’s the receipt', expect: 'CTN number is' },
//   ];
//   for (const { q, expect } of tests) {
//     const reply = await chatHandler(q, 'testuser');
//     console.log(`Q: ${q}\nAI: ${reply}\n---`);
//   }
// }

// runTests(); 