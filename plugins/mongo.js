'use strict'

const fp = require('fastify-plugin')

module.exports = fp(async function (fastify, opts) {
  const url = process.env.MONGO_URI
  const dbName = process.env.ORDER_DB_NAME || 'orderdb'

  if (!url) {
    console.warn('Warning: MongoDB URI not found. Recommendations endpoint will fail.')
    return
  }

  fastify.register(require('@fastify/mongodb'), {
    forceClose: true,
    url: url,
    database: dbName
  })
})