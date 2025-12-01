'use strict'

module.exports = async function (fastify, opts) {
  fastify.post('/', async function (request, reply) {
    const msg = request.body
    fastify.sendMessage(Buffer.from(JSON.stringify(msg)))
    reply.code(201)
  })

  fastify.get('/health', async function (request, reply) {
    const appVersion = process.env.APP_VERSION || '0.1.0'
    return { status: 'ok', version: appVersion }
  })

  fastify.get('/hugs', async function (request, reply) {
    return { hugs: fastify.someSupport() }
  })

  // GET /orders/recommendations/:productId
  fastify.get('/recommendations/:id', async (request, reply) => {
    const targetId = parseInt(request.params.id);
    const collection = fastify.mongo.db.collection('orders');

    const pipeline = [
      // Find only orders that contain the target product
      { $match: { "items.productId": targetId } },
      
      // Break the items array into individual documents
      { $unwind: "$items" },
      
      // Filter OUT the target product itself (we don't recommend what they are already looking at)
      { $match: { "items.productId": { $ne: targetId } } },
      
      // Group by Product ID and count occurrences
      { $group: { _id: "$items.productId", count: { $sum: 1 } } },
      
      // Sort by most frequent
      { $sort: { count: -1 } },
      
      // Take top 3
      { $limit: 3 }
    ];

    const results = await collection.aggregate(pipeline).toArray();
    
    // Return simple array of IDs: [1, 5, 8]
    return results.map(item => item._id);
  });
}
