// src/search/parsers/cheerioParser.js
import * as cheerio from "cheerio";

export function parseCompanyPage(html, url) {
  const $ = cheerio.load(html);

  return {
    name: $('meta[property="og:title"]').attr("content") || $("title").text(),
    emails: extractEmails($("body").text()),
    phones: extractPhones($("body").text()),
    social: {
      linkedin: $('a[href*="linkedin.com/company"]').attr("href"),
      twitter: $('a[href*="twitter.com"]').attr("href"),
    },
    employees: extractEmployeeCount($),
    tech: detectTechStack($),
  };
}

function extractEmails(text) {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  return [...new Set(text.match(emailRegex) || [])];
}

function extractPhones(text) {
  const phoneRegex = /(\+?1?[-.]?)?\(?[0-9]{3}\)?[-.]?[0-9]{3}[-.]?[0-9]{4}/g;
  return [...new Set(text.match(phoneRegex) || [])];
}

function extractEmployeeCount($) {
  const aboutPage = $('a[href*="/about"]').attr("href");
  // Return pattern for detection
  return { detected: !!aboutPage, url: aboutPage };
}
