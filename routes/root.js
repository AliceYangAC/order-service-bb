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
    // 1. Match orders containing the target product
    { $match: { "items.product": targetId } },
    
    // 2. Flatten the items array
    { $unwind: "$items" },
    
    // 3. Filter OUT the target product itself
    { $match: { "items.product": { $ne: targetId } } },
    
    // 4. Group by Product ID and count them
    { $group: { _id: "$items.product", count: { $sum: 1 } } },
    
    // 5. Sort by popularity (highest count first)
    { $sort: { count: -1 } },
    
    // 6. Limit to top 3 recommendations
    { $limit: 3 }
  ];

  const results = await collection.aggregate(pipeline).toArray();
  
  // Return array of IDs (e.g., [3, 4, 5])
  return results.map(item => item._id);
});