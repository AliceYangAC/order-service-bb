'use strict'

const fp = require('fastify-plugin')
const { ServiceBusClient } = require("@azure/service-bus"); 

module.exports = fp(async function (fastify, opts) {
    const ASB_CONNECTION_STRING = process.env.ASB_CONNECTION_STRING;
    const ASB_QUEUE_NAME = process.env.ASB_QUEUE_NAME;

    fastify.decorate('sendMessage', function (message) {
        const body = message.toString()
        if (process.env.ORDER_QUEUE_USERNAME && process.env.ORDER_QUEUE_PASSWORD) {
            console.log(`sending message ${body} to ${process.env.ORDER_QUEUE_NAME} on ${process.env.ORDER_QUEUE_HOSTNAME} using local auth credentials`)
            
            const rhea = require('rhea')
            const container = rhea.create_container()
            var amqp_message = container.message;

            const connectOptions = {
                hostname: process.env.ORDER_QUEUE_HOSTNAME,
                host: process.env.ORDER_QUEUE_HOSTNAME,
                port: process.env.ORDER_QUEUE_PORT,
                username: process.env.ORDER_QUEUE_USERNAME,
                password: process.env.ORDER_QUEUE_PASSWORD,
                reconnect_limit: process.env.ORDER_QUEUE_RECONNECT_LIMIT || 0
            }
            
            if (process.env.ORDER_QUEUE_TRANSPORT !== undefined) {
                connectOptions.transport = process.env.ORDER_QUEUE_TRANSPORT
            }
            
            const connection = container.connect(connectOptions)
            
            container.once('sendable', function (context) {
                const sender = context.sender;
                sender.send({
                    body: amqp_message.data_section(Buffer.from(body,'utf8'))
                });
                sender.close();
                connection.close();
            })

            connection.open_sender(process.env.ORDER_QUEUE_NAME)

        // For local development and testing with ASB emulator
        } else if (ASB_CONNECTION_STRING) {
            
            if (!ASB_QUEUE_NAME) {
                console.log('no queue name set for ASB. exiting.');
                return;
            }

            console.log(`sending message ${body} to ${ASB_QUEUE_NAME} using Azure Service Bus Connection String`);

            async function sendMessage() {
                // Connects using the connection string (works for local dev and cloud SAS keys)
                const sbClient = new ServiceBusClient(ASB_CONNECTION_STRING);
                const sender = sbClient.createSender(ASB_QUEUE_NAME);

                try {
                    await sender.sendMessages({ body: body });
                } catch(error) {
                    console.error('ASB SEND ERROR:', error);
                } finally {
                    await sender.close();
                    await sbClient.close();
                }
            }
            sendMessage().catch(console.error);
        
        // For cloud deployment using Workload Identity
        } else if (process.env.USE_WORKLOAD_IDENTITY_AUTH === 'true') {
            const { DefaultAzureCredential } = require("@azure/identity");

            const fullyQualifiedNamespace = process.env.ORDER_QUEUE_HOSTNAME || process.env.AZURE_SERVICEBUS_FULLYQUALIFIEDNAMESPACE;

            console.log(`sending message ${body} to ${process.env.ORDER_QUEUE_NAME} on ${fullyQualifiedNamespace} using Microsoft Entra ID Workload Identity credentials`);
            
            if (!fullyQualifiedNamespace) {
                console.log('no hostname set for message queue. exiting.');
                return;
            }
            
            const queueName = process.env.ORDER_QUEUE_NAME

            const credential = new DefaultAzureCredential();

            async function sendMessage() {
                const sbClient = new ServiceBusClient(fullyQualifiedNamespace, credential);
                const sender = sbClient.createSender(queueName);

                try {
                    await sender.sendMessages({ body: body });
                } finally {
                    await sender.close();
                    await sbClient.close();
                }
            }
            sendMessage().catch(console.error);
        } else {
            console.log('no credentials set for message queue. exiting.')
            return
        }
    })
})