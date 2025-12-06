'use strict'

const NodeGeocoder = require('node-geocoder');
const crypto = require('crypto');

const geocoder = NodeGeocoder({
  provider: 'openstreetmap',
  httpAdapter: 'https',
  headers: { 'User-Agent': 'BestBuyClone/1.0' }
});

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
    if (cleanCode.length === 6) {
        cleanCode = cleanCode.slice(0, 3) + " " + cleanCode.slice(3);
    }
    shipping.postalCode = cleanCode;

    // validate payment info
    const payment = order.payment;
    if (!payment || !validPaymentTypes.includes(payment.paymentType)) {
      reply.code(400).send({ error: "Invalid Payment Type" });
      return;
    }

    // mocked payment gateway processing
    order.payment = {
      provider: "Spot",
      paymentType: payment.paymentType,
      transactionId: crypto.randomUUID(),
      last4: Math.floor(1000 + Math.random() * 9000).toString(),
      status: "Paid"
    };

    // send to Azure Service Bus
    const msgBody = JSON.stringify(order);
    if (fastify.sendMessage) {
        fastify.sendMessage(Buffer.from(msgBody));
    }

    // --- OPTIONAL: SAVE TO DB HERE ---
    // (If you want to save orders to Cosmos/Mongo as well as Service Bus)
    // if (fastify.mongo && fastify.mongo.db) {
    //    const collection = fastify.mongo.db.collection('orders');
    //    // Adapt insertion logic if using Cosmos wrapper vs Mongo driver
    // }

    reply.code(201).send({ status: "Order Created", transactionId: order.payment.transactionId });
  });
  
  fastify.get('/health', async function (request, reply) {
    // Return DB Type for debugging
    const dbType = process.env.USE_WORKLOAD_IDENTITY_AUTH === 'true' ? 'CosmosSQL' : 'Mongo';
    const appVersion = process.env.APP_VERSION || '0.1.0'
    return { status: 'ok', version: appVersion, db: dbType }
  })

  fastify.get('/hugs', async function (request, reply) {
    return { hugs: fastify.someSupport() }
  })

  fastify.get('/recommendations/:id', async (request, reply) => {
    // Safety check in case DB init failed
    if (!fastify.mongo || !fastify.mongo.db) {
        reply.code(503).send({ error: "Database not available" });
        return;
    }

    const targetId = parseInt(request.params.id);
    const collection = fastify.mongo.db.collection('orders');

    // This pipeline object is passed to our Adapter
    const pipeline = [
      { $match: { "items.product": targetId } },
      { $unwind: "$items" },
      { $match: { "items.product": { $ne: targetId } } },
      { $group: { _id: "$items.product", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 3 }
    ];

    // The Adapter's .aggregate() handles the translation to SQL if using Cosmos
    const results = await collection.aggregate(pipeline).toArray();
    
    // Ensure results match expected format [{_id: 123}, {_id: 456}]
    return results.map(item => item._id);
  });
}