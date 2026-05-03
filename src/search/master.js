import { searchWithExa } from "./providers/exa.js";
import { searchWithBrave } from "./providers/brave.js";
import { scrapeWithJina } from "./providers/jina.js";
import { scrapeWithFirecrawl } from "./providers/firecrawl.js";
import { CONFIG } from "../config/config.js";

export async function searchWeb(query, searchType = "semantic", options = {}) {
    const limit = options.limit || 10;

    // Try Exa first for semantic search
    if ((searchType === "semantic" || searchType === "auto") && process.env.EXA_API_KEY) {
        try {
            const exaResult = await searchWithExa(query, process.env.EXA_API_KEY, { limit });
            if (exaResult && exaResult.results) {
                return {
                    success: true,
                    results: exaResult.results.map(r => ({
                        url: r.url,
                        title: r.title,
                        description: r.text || r.snippet || "",
                        content: r.text || ""
                    }))
                };
            }
        } catch (e) {
            console.warn("Exa search error:", e.message);
        }
    }

    // Fallback to Brave
    if (process.env.BRAVE_API_KEY) {
        try {
            const braveResult = await searchWithBrave(query, process.env.BRAVE_API_KEY, {
                limit,
            });
            if (braveResult?.web?.results) {
                return {
                    success: true,
                    results: braveResult.web.results.map(r => ({
                        url: r.url,
                        title: r.title,
                        description: r.description || ""
                    }))
                };
            }
        } catch (e) {
            console.warn("Brave search error:", e.message);
        }
    }

    return { success: false, error: "No search provider available or search failed" };
}

export async function scrapeUrl(url) {
    // Try Firecrawl first if API key exists
    if (process.env.FIRECRAWL_API_KEY) {
        try {
            const fcResult = await scrapeWithFirecrawl(url, process.env.FIRECRAWL_API_KEY);
            if (fcResult?.success && fcResult?.data) {
                return {
                    success: true,
                    markdown: fcResult.data.markdown,
                    content: fcResult.data.content || fcResult.data.markdown,
                };
            }
        } catch (e) {
            console.warn("Firecrawl scrape error:", e.message);
        }
    }

    // Fallback to Jina (Free, no API key required)
    try {
        const jinaResult = await scrapeWithJina(url);
        if (jinaResult.success) {
            return {
                success: true,
                markdown: jinaResult.content,
                content: jinaResult.content
            };
        }
    } catch (e) {
        console.warn("Jina scrape error:", e.message);
    }

    return { success: false, error: "Scraping failed" };
}
