import {
  createPuppeteerRouter,
  PuppeteerCrawler,
  Router,
  PuppeteerCrawlingContext,
  PuppeteerCrawlerOptions,
} from 'crawlee'
import { minimatch } from 'minimatch'
import DefaultScraper from './scrapers/default'
import DocsearchScraper from './scrapers/docssearch'
import SchemaScraper from './scrapers/schema'
import { Sender } from './sender'
import { Config, Scraper } from './types'
import { Webhook } from './webhook.js'
import { PuppeteerNode } from 'puppeteer-core'

type DefaultHandler = Parameters<
  Parameters<Router<PuppeteerCrawlingContext>['addDefaultHandler']>[0]
>[0]

// Crawler class
// This class is responsible for crawling the urls and extract content to send to Meilisearch
// It uses the createPuppeteerRouter method to create a router that will be used by the PuppeteerCrawler.
// The constructor take a Sender object as a parameter
export class Crawler {
  sender: Sender
  config: Config
  urls: string[]
  scraper: Scraper
  crawler: PuppeteerCrawler
  nb_page_crawled = 0
  nb_page_indexed = 0

  constructor(
    sender: Sender,
    config: Config,
    launchOptions: Record<string, any> = {},
    launcher?: PuppeteerNode
  ) {
    console.info('Crawler::constructor')
    this.sender = sender
    this.config = config
    this.urls = config.start_urls

    this.scraper =
      config.strategy == 'docssearch'
        ? new DocsearchScraper(this.sender)
        : config.strategy == 'schema'
        ? new SchemaScraper(this.sender, config)
        : new DefaultScraper(this.sender, config)

    //Create the router
    const router = createPuppeteerRouter()

    // type DefaultHandler = Parameters<typeof router.addDefaultHandler>[0];
    router.addDefaultHandler(this.defaultHandler.bind(this))

    const puppeteerCrawlerOptions: PuppeteerCrawlerOptions = {
      requestHandler: router,
      launchContext: {
        launchOptions: {
          headless: config.headless || true,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
          ignoreDefaultArgs: ['--disable-extensions'],
          ...launchOptions,
        },
      },
    }

    if (puppeteerCrawlerOptions.launchContext && launcher) {
      puppeteerCrawlerOptions.launchContext.launcher = launcher
    }
    // create the crawler
    this.crawler = new PuppeteerCrawler(puppeteerCrawlerOptions)
  }

  async run() {
    let interval = 5000
    if (process.env.WEBHOOK_INTERVAL) {
      interval = parseInt(process.env.WEBHOOK_INTERVAL)
    }

    const intervalId = setInterval(async () => {
      await Webhook.get().active(this.config, {
        nb_page_crawled: this.nb_page_crawled,
        nb_page_indexed: this.nb_page_indexed,
        nb_documents_sent: this.sender.nb_documents_sent,
      })
    }, interval)

    await this.crawler.run(this.urls)

    // Stuck here

    clearInterval(intervalId)

    await Webhook.get().active(this.config, {
      nb_page_crawled: this.nb_page_crawled,
      nb_page_indexed: this.nb_page_indexed,
      nb_documents_sent: this.sender.nb_documents_sent,
    })
  }

  // Should we use `log`
  async defaultHandler({ request, enqueueLinks, page }: DefaultHandler) {
    this.nb_page_crawled++
    const title = await page.title()
    console.log(`${title}`, { url: request.loadedUrl })
    const crawled_globs = this.__generate_globs(this.urls)
    const excluded_crawled_globs = this.__generate_globs(
      this.config.urls_to_exclude || []
    )
    const indexed_globs = this.__generate_globs(
      this.config.urls_to_index || this.urls
    )
    const excluded_indexed_globs = this.__generate_globs(
      this.config.urls_to_not_index || []
    )

    if (request.loadedUrl && !this.__is_paginated_url(request.loadedUrl)) {
      //check if the url is in the list of urls to scrap
      if (
        this.__match_globs(request.loadedUrl, indexed_globs) &&
        !this.__match_globs(request.loadedUrl, excluded_indexed_globs)
      ) {
        this.nb_page_indexed++
        await this.scraper.get(request.loadedUrl, page)
      }
    }

    await enqueueLinks({
      globs: crawled_globs,
      exclude: excluded_crawled_globs,
      transformRequestFunction: (req) => {
        // exclude all links that are files not parsable by puppeteer
        if (this.__is_file_url(req.url)) {
          return false
        }
        // remove all query params to avoid duplicates
        const urlObject = new URL(req.url)
        urlObject.search = ''
        // Remove all anchors to avoid duplicates
        urlObject.hash = ''
        req.url = urlObject.toString()

        return req
      },
    })
  }

  __generate_globs(urls: string[]) {
    return urls.map((url) => {
      if (url.endsWith('/')) {
        return url + '**'
      }
      return url + '/**'
    })
  }

  __match_globs(url: string, globs: string[]) {
    return globs.some((glob) => minimatch(url, glob))
  }

  __is_file_url(url: string) {
    const fileExtensions = [
      '.zip',
      '.pdf',
      '.doc',
      '.docx',
      '.xls',
      '.xlsx',
      '.ppt',
      '.pptx',
      '.rar',
      '.tar',
      '.gz',
      '.tgz',
      '.7z',
      '.bz2',
      '.jpg',
      '.jpeg',
      '.png',
      '.gif',
      '.svg',
      '.css',
      '.js',
      '.xml',
      '.txt',
      '.csv',
      '.rtf',
      '.mp3',
      '.wav',
      '.mp4',
      '.avi',
      '.mkv',
      '.mov',
      '.flv',
      '.wmv',
      '.m4v',
      '.ogg',
      '.mpg',
      '.mpeg',
      '.swf',
    ]
    return fileExtensions.some((extension) => url.endsWith(extension))
  }

  __is_paginated_url(url: string) {
    const urlObject = new URL(url)
    const pathname = urlObject.pathname
    return /\/\d+\//.test(pathname)
  }
}
