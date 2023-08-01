import * as dotenv from 'dotenv'
dotenv.config()

import express from 'express'
import { TaskQueue } from './taskQueue'
import { Sender } from './sender'
import { Crawler } from './crawler'
import { Webhook } from './webhook.js'

const port = process.env.PORT || 8080

class Server {
  taskQueue: TaskQueue
  app: express.Application

  constructor() {
    this.__check_env()

    this.taskQueue = new TaskQueue()
    this.app = express()
    this.app.use(express.json())
    this.app.post('/crawl', this.__asyncCrawl.bind(this))
    this.app.post('/crawl/async', this.__asyncCrawl.bind(this))
    this.app.post('/crawl/sync', this.__syncCrawl.bind(this))
    this.app.post('/crawl/start', this.__startCrawl.bind(this))
    this.app.post('/webhook', this.__log_webhook.bind(this))

    this.app.listen(port, () =>
      console.log(`Crawler app listening on port ${port}!`)
    )
  }

  __check_env() {
    const { REDIS_URL, WEBHOOK_URL, WEBHOOK_TOKEN, WEBHOOK_INTERVAL } =
      process.env

    console.log('REDIS_URL: ', REDIS_URL)
    console.log('WEBHOOK_URL: ', WEBHOOK_URL)
    console.log('WEBHOOK_TOKEN: ', WEBHOOK_TOKEN)
    console.log('WEBHOOK_INTERVAL: ', WEBHOOK_INTERVAL)
  }

  __asyncCrawl(req: express.Request, res: express.Response) {
    this.taskQueue.add(req.body)
    console.log('Crawling started')
    res.send('Crawling started')
  }

  async __syncCrawl(req: express.Request, res: express.Response) {
    await Webhook.get().started(req.body)

    const sender = new Sender(req.body)
    await sender.init()

    const crawler = new Crawler(sender, req.body)

    await crawler.run()
    const nbDocuments = await sender.finish()

    await Webhook.get().completed(req.body, nbDocuments)
    res.send('Crawling finished')
  }

  async __startCrawl(req: express.Request, res: express.Response) {
    await Webhook.get().started(req.body)
    console.log('Crawling started')
    res.send('Crawling started')

    const sender = new Sender(req.body)
    await sender.init()

    const crawler = new Crawler(sender, req.body)

    await crawler.run()
    const nbDocuments = await sender.finish()

    await Webhook.get().completed(req.body, nbDocuments)
  }

  __log_webhook(req: express.Request, res: express.Response) {
    console.log('webhook received: ', req.body)
    res.send('ok')
  }
}

new Server()
