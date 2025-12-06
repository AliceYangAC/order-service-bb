'use strict'

const fp = require('fastify-plugin')
const { CosmosClient } = require('@azure/cosmos')
const { DefaultAzureCredential } = require('@azure/identity')

module.exports = fp(async function (fastify, opts) {
  const useWorkloadIdentity = process.env.USE_WORKLOAD_IDENTITY_AUTH === 'true'
  
  // --- STRATEGY 1: AZURE COSMOS DB (SQL API) ---
  if (useWorkloadIdentity) {
    const endpoint = process.env.ORDER_DB_URI
    const dbName = process.env.ORDER_DB_NAME || 'orderdb'
    const containerName = 'orders'

    if (!endpoint) {
      console.warn('Warning: ORDER_DB_URI not found for Cosmos DB.')
      return
    }

    try {
      // 1. Authenticate using Workload Identity
      const credential = new DefaultAzureCredential()
      const client = new CosmosClient({ endpoint, credential })
      
      // 2. Ensure Database/Container exist
      const { database } = await client.databases.createIfNotExists({ id: dbName })
      const { container } = await database.containers.createIfNotExists({ id: containerName })
      
      console.log(`Connected to Cosmos DB (SQL API) via Workload Identity: ${endpoint}`)

      // 3. Create a "Mongo-Like" Adapter
      // This mimics the structure fastify.mongo.db.collection('x').aggregate(...)
      const mockDb = {
        collection: (name) => {
          return {
            aggregate: (pipeline) => {
              // DETECT RECOMMENDATION QUERY
              // The route passes a pipeline starting with $match on "items.product".
              // We translate this specific pipeline to SQL.
              const matchStage = pipeline.find(s => s.$match && s.$match["items.product"])
              
              if (matchStage) {
                const targetId = matchStage.$match["items.product"]
                
                // Equivalent SQL Query for the "Basket Analysis" aggregation
                const querySpec = {
                  query: `
                    SELECT TOP 3 item.product as _id, COUNT(1) as count 
                    FROM c 
                    JOIN item IN c.items 
                    WHERE ARRAY_CONTAINS(c.items, {'product': @targetId}, true) 
                    AND item.product != @targetId 
                    GROUP BY item.product 
                  `,
                  parameters: [
                    { name: "@targetId", value: targetId }
                  ]
                }

                // Return an object with toArray() to mimic Mongo Driver Cursor
                return {
                  toArray: async () => {
                    try {
                      const { resources } = await container.items.query(querySpec).fetchAll()
                      return resources
                    } catch (err) {
                      console.error("Cosmos Query Error:", err)
                      return []
                    }
                  }
                }
              }

              // Fallback for unknown pipelines
              console.warn("Unknown aggregation pipeline used with Cosmos Adapter")
              return { toArray: async () => [] }
            }
          }
        }
      }

      // 4. Decorate Fastify to match the @fastify/mongodb interface
      fastify.decorate('mongo', { db: mockDb })

    } catch (err) {
      console.error('Failed to connect to Cosmos DB:', err)
    }

  // --- STRATEGY 2: STANDARD MONGODB ---
  } else {
    const url = process.env.ORDER_DB_URI || process.env.MONGO_URI
    const dbName = process.env.ORDER_DB_NAME || 'orderdb'

    if (!url) {
      console.warn('Warning: MongoDB URI not found. Recommendations endpoint will fail.')
      return
    }

    // Use the standard plugin
    fastify.register(require('@fastify/mongodb'), {
      forceClose: true,
      url: url,
      database: dbName
    })
    console.log(`Connected to Standard MongoDB: ${dbName}`)
  }
})