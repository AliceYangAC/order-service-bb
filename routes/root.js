'use strict'

const NodeGeocoder = require('node-geocoder');
const crypto = require('crypto'); // Used to generate fake transaction IDs if missing

// configure to use OpenStreetMap
const geocoder = NodeGeocoder({
  provider: 'openstreetmap',
  httpAdapter: 'https',
  headers: { 'User-Agent': 'BestBuyClone/1.0' }
});

const postalCodeRegex = /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/;
const validPaymentTypes = ['VISA', 'MASTERCARD', 'AMEX'];

module.exports = async function (fastify, opts) {
  fastify.post('/', async function (request, reply) {
    const order = request.body;
    
    // validate items
    if (!order.items || order.items.length === 0) {
      reply.code(400).send({ error: "Order must contain items" });
      return;
    }

    // validate shipping info
    const shipping = order.shipping;
    if (!shipping || !shipping.address1 || !shipping.city || !shipping.province || !shipping.postalCode) {
      reply.code(400).send({ error: "Missing required shipping fields" });
      return;
    }

    // verify Address if not confirmed
    if (order.addressConfirmed !== true) {
      const fullAddressQuery = `${shipping.address1}, ${shipping.city}, ${shipping.province}, ${shipping.postalCode}, Canada`;
      console.log(`Verifying: ${fullAddressQuery}`);

      try {
        const results = await geocoder.geocode(fullAddressQuery);

        if (!results || results.length === 0) {
          reply.code(409).send({ 
              error: "Address not found. Use anyway?", 
              suggestion: shipping 
          });
          return;
        }

        const bestMatch = results[0];
        if (bestMatch.countryCode !== 'CA') {
          reply.code(400).send({ error: "Shipping must be within Canada." });
          return;
        }

        const suggestedAddress = {
          address1: `${bestMatch.streetNumber || ''} ${bestMatch.streetName || ''}`.trim() || shipping.address1,
          city: bestMatch.city || shipping.city,
          province: bestMatch.state || shipping.province,
          postalCode: bestMatch.zipcode || shipping.postalCode
        };

        reply.code(409).send({ 
          error: "Address Verification Required",
          suggestion: suggestedAddress 
        });
        return;

      } catch (err) {
        console.error("Geocoding failed", err);
        reply.code(500).send({ error: "Address verification unavailable." });
        return;
      }
    }

    // Normalize to UpperCase
    let cleanCode = shipping.postalCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
    
    // Force standard format "K1A 0B1" (3 chars, space, 3 chars)
    if (cleanCode.length === 6) {
        cleanCode = cleanCode.slice(0, 3) + " " + cleanCode.slice(3);
    }
    
    // Update the object so the Geocoder AND Database use the clean version
    shipping.postalCode = cleanCode;

    // validate payment info
    const payment = order.payment;
    if (!payment || !validPaymentTypes.includes(payment.paymentType)) {
      reply.code(400).send({ error: "Invalid Payment Type" });
      return;
    }

    // mocked payment gateway processing
    order.payment = {
      provider: "Spot", // Mocked payment gateway; like Stripe :)
      paymentType: payment.paymentType, // VISA/MC/AMEX
      transactionId: crypto.randomUUID(), // Unique charge ID from the "Gateway"
      last4: Math.floor(1000 + Math.random() * 9000).toString(), // The safe "4242" display data
      status: "Paid"
    };

    // send to Azure Service Bus
    const msgBody = JSON.stringify(order);
    fastify.sendMessage(Buffer.from(msgBody));

    reply.code(201).send({ status: "Order Created", transactionId: order.payment.transactionId });
  });
  
  // Health check endpoint
  fastify.get('/health', async function (request, reply) {
    const appVersion = process.env.APP_VERSION || '0.1.0'
    return { status: 'ok', version: appVersion }
  })

  // Support endpoint
  fastify.get('/hugs', async function (request, reply) {
    return { hugs: fastify.someSupport() }
  })

  // Recommendations endpoint: returns top 3 products frequently bought with the given product ID
  fastify.get('/recommendations/:id', async (request, reply) => {
    const targetId = parseInt(request.params.id);
    const collection = fastify.mongo.db.collection('orders');

    const pipeline = [
      { $match: { "items.product": targetId } },
      { $unwind: "$items" },
      { $match: { "items.product": { $ne: targetId } } },
      { $group: { _id: "$items.product", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 3 }
    ];

    const results = await collection.aggregate(pipeline).toArray();
    return results.map(item => item._id);
  });
}