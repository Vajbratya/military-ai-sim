export interface NewsArticle {
  title: string;
  pubDate: string;
  link: string;
}

export async function fetchLiveNews(query: string): Promise<NewsArticle[]> {
  try {
    // We use a free RSS to JSON proxy to fetch Google News headlines.
    // Querying the names of the two countries/HQs to get relevant geopolitical news.
    const encodedQuery = encodeURIComponent(`${query} conflict OR military`);
    const rssUrl = `https://news.google.com/rss/search?q=${encodedQuery}&hl=en-US&gl=US&ceid=US:en`;
    const proxyUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`;
    
    const response = await fetch(proxyUrl);
    if (!response.ok) {
      console.warn("News proxy returned non-OK status");
      return [];
    }
    
    const data = await response.json();
    
    if (data && data.items && Array.isArray(data.items)) {
      // Take the top 4 most recent relevant headlines
      return data.items.slice(0, 4).map((item: any) => ({
        title: item.title,
        pubDate: item.pubDate,
        link: item.link
      }));
    }
    return [];
  } catch (error) {
    console.error("Failed to fetch live OSINT news:", error);
    return [];
  }
}
