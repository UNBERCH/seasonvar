(function() {
    'use strict';

    const config = {
        baseUrl: 'https://seasonvar.ru',
        cacheKeyPrefix: 'seasonvar_',
        updateInterval: 6 * 60 * 60 * 1000, // 6 годин у мілісекундах
        timeout: 10000 // 10 секунд таймаут для запитів
    };

    class SeasonvarAPI {
        constructor() {
            this.parser = new DOMParser();
        }

        // Утилітна функція для кешування
        async loadCachedContent(url, cacheName, processor) {
            const cacheKey = `${config.cacheKeyPrefix}${cacheName}`;
            const timeKey = `${cacheKey}_time`;
            const now = Date.now();
            const lastUpdate = localStorage.getItem(timeKey);

            if (lastUpdate && (now - lastUpdate) < config.updateInterval) {
                const cachedData = localStorage.getItem(cacheKey);
                if (cachedData) return JSON.parse(cachedData);
            }

            try {
                const response = await this.fetchWithTimeout(url);
                const data = await processor(response);
                
                if (data.length > 0) {
                    localStorage.setItem(cacheKey, JSON.stringify(data));
                    localStorage.setItem(timeKey, now);
                }
                return data;
            } catch (error) {
                console.error(`Помилка завантаження ${url}:`, error);
                const cachedData = localStorage.getItem(cacheKey);
                return cachedData ? JSON.parse(cachedData) : [];
            }
        }

        // Допоміжна функція fetch з таймаутом
        async fetchWithTimeout(url) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), config.timeout);
            
            try {
                const response = await fetch(url, { signal: controller.signal });
                clearTimeout(timeoutId);
                if (!response.ok) throw new Error(`HTTP error ${response.status}`);
                return response.text();
            } catch (error) {
                clearTimeout(timeoutId);
                throw error;
            }
        }

        // Отримання списку контенту
        async getContent(url, cacheName) {
            return this.loadCachedContent(url, cacheName, async (html) => {
                const doc = this.parser.parseFromString(html, 'text/html');
                const items = [];

                for (const el of doc.querySelectorAll('.short-story')) {
                    const title = el.querySelector('.title a')?.textContent?.trim();
                    const link = config.baseUrl + el.querySelector('.title a')?.getAttribute('href');
                    const img = el.querySelector('img')?.getAttribute('src');

                    if (title && link && img) {
                        items.push({ name: title, link, picture: img, type: 'movie' });
                    }
                }
                return items;
            });
        }

        // Отримання епізодів
        async getEpisodes(seriesUrl) {
            try {
                const html = await this.fetchWithTimeout(seriesUrl);
                const doc = this.parser.parseFromString(html, 'text/html');
                const episodes = [];

                for (const seasonEl of doc.querySelectorAll('.seasons-list .season')) {
                    const seasonTitle = seasonEl.querySelector('.season-title')?.textContent?.trim() || 'Сезон';

                    for (const episodeEl of seasonEl.querySelectorAll('.episode')) {
                        const episodeTitle = episodeEl.textContent.trim();
                        const episodeLink = episodeEl.getAttribute('data-url');

                        if (episodeTitle && episodeLink) {
                            episodes.push({
                                name: `${seasonTitle} - ${episodeTitle}`,
                                link: config.baseUrl + episodeLink,
                                type: 'episode'
                            });
                        }
                    }
                }
                return episodes;
            } catch (error) {
                console.error('Помилка завантаження епізодів:', error);
                return [];
            }
        }

        // Отримання прямих посилань на відео
        async getDirectVideoLink(episodeUrl) {
            const cacheKey = `${config.cacheKeyPrefix}video_${episodeUrl}`;
            const cachedVideo = localStorage.getItem(cacheKey);
            if (cachedVideo) return JSON.parse(cachedVideo);

            try {
                const html = await this.fetchWithTimeout(episodeUrl);
                const iframeMatch = html.match(/iframe src="(.*?)"/);
                if (!iframeMatch) return [];

                const iframeHtml = await this.fetchWithTimeout(iframeMatch[1]);
                const videoLinks = [
                    ...[...iframeHtml.matchAll(/file: "(https?:\/\/.*?\.mp4)"/g)]
                        .map(m => ({ file: m[1], type: 'mp4' })),
                    ...[...iframeHtml.matchAll(/file: "(https?:\/\/.*?\.m3u8)"/g)]
                        .map(m => ({ file: m[1], type: 'hls' }))
                ];

                if (videoLinks.length > 0) {
                    localStorage.setItem(cacheKey, JSON.stringify(videoLinks));
                }
                return videoLinks;
            } catch (error) {
                console.error('Помилка отримання відео:', error);
                return [];
            }
        }
    }

    // Ініціалізація плагіну
    function initializePlugin() {
        const api = new SeasonvarAPI();

        Lampa.Source.add('seasonvar', {
            title: 'Seasonvar',
            icon: `${config.baseUrl}/favicon.ico`,
            search: true,

            async onSearch(query, callback) {
                const searchUrl = `${config.baseUrl}/search?query=${encodeURIComponent(query)}`;
                callback(await api.getContent(searchUrl, `search_${query}`));
            },

            onStart(search, callback) {
                const categories = [
                    { title: 'Новинки', url: `${config.baseUrl}/new` },
                    { title: 'Популярне', url: `${config.baseUrl}/top` },
                    { title: 'Жанри', url: `${config.baseUrl}/genres` }
                ];
                callback(categories.map(cat => ({ name: cat.title, link: cat.url, type: 'category' })));
            },

            async onCategory(category, callback) {
                callback(await api.getContent(category.link, `category_${category.name}`));
            },

            async onMovie(movie, callback) {
                const episodes = await api.getEpisodes(movie.link);
                callback(episodes.length > 0 ? episodes : [{ name: 'Серії не знайдено', link: '#', type: 'info' }]);
            },

            async onEpisode(episode, callback) {
                callback(await api.getDirectVideoLink(episode.link));
            }
        });
    }

    initializePlugin();
})();