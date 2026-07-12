export interface LocalBookMetadata {
  key: string;
  name: string;
  author: string;
  publisher?: string;
  description?: string;
  cover?: string;
  source: "openlibrary" | "googlebooks";
}

const REQUEST_TIMEOUT = 15000;

const asText = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const stripHtml = (value: unknown): string =>
  asText(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

async function fetchJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Metadata request failed (HTTP ${response.status})`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function mapOpenLibrary(data: any): LocalBookMetadata[] {
  if (!Array.isArray(data?.docs)) return [];
  return data.docs
    .map((item: any) => {
      const title = asText(item?.title);
      const key = asText(item?.key);
      if (!title || !key) return null;
      const coverId = item?.cover_i;
      return {
        key: `openlibrary:${key}`,
        name: title,
        author: Array.isArray(item?.author_name)
          ? item.author_name.filter(Boolean).join(", ")
          : "",
        publisher: Array.isArray(item?.publisher) ? asText(item.publisher[0]) : "",
        description: "",
        cover: Number.isFinite(coverId)
          ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
          : "",
        source: "openlibrary" as const,
      };
    })
    .filter(Boolean)
    .slice(0, 10);
}

function mapGoogleBooks(data: any): LocalBookMetadata[] {
  if (!Array.isArray(data?.items)) return [];
  return data.items
    .map((item: any) => {
      const info = item?.volumeInfo || {};
      const title = asText(info.title);
      const id = asText(item?.id);
      if (!title || !id) return null;
      const imageLinks = info.imageLinks || {};
      const cover = asText(
        imageLinks.thumbnail || imageLinks.smallThumbnail || imageLinks.large
      ).replace(/^http:/, "https:");
      return {
        key: `googlebooks:${id}`,
        name: title,
        author: Array.isArray(info.authors) ? info.authors.filter(Boolean).join(", ") : "",
        publisher: asText(info.publisher),
        description: stripHtml(info.description),
        cover,
        source: "googlebooks" as const,
      };
    })
    .filter(Boolean)
    .slice(0, 10);
}

/**
 * Searches freely available catalogues in a privacy-conscious order.  Open
 * Library is tried first; Google Books is only contacted when it returns no
 * usable matches or is unavailable.
 */
export async function searchBookMetadata(
  title: string,
  author: string
): Promise<LocalBookMetadata[]> {
  const cleanedTitle = title.trim();
  const cleanedAuthor = author.trim();
  const openLibraryQuery = new URLSearchParams({ limit: "10" });
  if (cleanedTitle) openLibraryQuery.set("title", cleanedTitle);
  if (cleanedAuthor) openLibraryQuery.set("author", cleanedAuthor);

  try {
    const results = mapOpenLibrary(
      await fetchJson(`https://openlibrary.org/search.json?${openLibraryQuery}`)
    );
    if (results.length) return results;
  } catch (error) {
    console.warn("Open Library metadata search failed", error);
  }

  const terms = [
    cleanedTitle && `intitle:${cleanedTitle}`,
    cleanedAuthor && `inauthor:${cleanedAuthor}`,
  ].filter(Boolean);
  if (!terms.length) return [];
  try {
    return mapGoogleBooks(
      await fetchJson(
        `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(
          terms.join(" ")
        )}&maxResults=10&printType=books`
      )
    );
  } catch (error) {
    console.warn("Google Books metadata search failed", error);
    return [];
  }
}
