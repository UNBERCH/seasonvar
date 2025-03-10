(function() {
    'use strict';

    // Конфігурація
    const config = {
        baseUrl: 'https://seasonvar.ru',
        cacheKeyPrefix: 'seasonvar_',
        updateInterval: 6 * 60 * 60 * 1000, // 6 годин у мілісекундах
        timeout: 10000 // 10 секунд таймаут для запитів
    };

    // Клас для роботи з Seasonvar
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

            if (lastUpdate && (now - parseInt(lastUpdate)) < config.updateInterval) {
                const cachedData = localStorage.getItem(cacheKey);
                if (cachedData) return JSON.parse(cachedData);
            }

            try {
                const response = await this.fetchWithTimeout(url);
                const data = await processor(response);
                
                if (data && data.length > 0) {
                    localStorage.setItem(cacheKey, JSON.stringify(data));
                    localStorage.setItem(timeKey, now.toString());
                }
                return data;
            } catch (error) {
                console.error(`Помилка завантаження ${url}:`, error);
                const cachedData = localStorage.getItem(cacheKey);
                return cachedData ? JSON.parse(cachedData) : [];
            }
        }

        // Fetch із таймаутом
        async fetchWithTimeout(url) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), config.timeout);
            
            try {
                const response = await fetch(url, { 
                    signal: controller.signal,
                    headers: { 'User-Agent': 'Mozilla/5.0' } // Додано для обходу можливих блокувань
                });
                clearTimeout(timeoutId);
                if (!response.ok) throw new Error(`HTTP error ${response.status}`);
                return response.text();
            } catch (error) {
                clearTimeout(timeoutId);
                throw error.name === 'AbortError' ? new Error('Request timed out') : error;
            }
        }

        // Отримання списку контенту
        async getContent(url, cacheName) {
            return this.loadCachedContent(url, cacheName, async (html) => {
                const doc = this.parser.parseFromString(html, 'text/html');
                const items = [];

                // Оновлений селектор для гнучкості
                const contentElements = doc.querySelectorAll('.pgs-serials-list .short, .short-story');
                for (const el of contentElements) {
                    const titleEl = el.querySelector('.title a, .short-title a');
                    const title = titleEl?.textContent?.trim();
                    const link = titleEl ? new URL(titleEl.getAttribute('href'), config.baseUrl).href : null;
                    const img = el.querySelector('img')?.getAttribute('src') || el.querySelector('img')?.getAttribute('data-src');

                    if (title && link) {
                        items.push({
                            name: title,
                            link,
                            picture: img ? new URL(img, config.baseUrl).href : null,
                            type: 'movie'
                        });
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

                // Універсальніший підхід до сезонів і епізодів
                const seasonBlocks = doc.querySelectorAll('.film-translation-block, .seasons-list .season');
                if (seasonBlocks.length === 0) {
                    // Якщо сезони не знайдені, шукаємо прямі посилання
                    const episodeEls = doc.querySelectorAll('.pgs-player source, .episode-item');
                    for (const ep of episodeEls) {
                        const epTitle = ep.getAttribute('data-title') || ep.textContent?.trim() || 'Епізод';
                        const epLink = ep.getAttribute('data-url') || ep.getAttribute('src');
                        if (epLink) {
                            episodes.push({
                                name: epTitle,
                                link: new URL(epLink, config.baseUrl).href,
                                type: 'episode'
                            });
                        }
                    }
                } else {
                    for (const seasonEl of seasonBlocks) {
                        const seasonTitle = seasonEl.querySelector('.season-title, h3')?.textContent?.trim() || 'Сезон';
                        const episodeEls = seasonEl.querySelectorAll('.episode, .episode-item');
                        for (const ep of episodeEls) {
                            const epTitle = ep.textContent?.trim() || 'Епізод';
                            const epLink = ep.getAttribute('data-url') || ep.getAttribute('href');
                            if (epTitle && epLink) {
                                episodes.push({
                                    name: `${seasonTitle} - ${epTitle}`,
                                    link: new URL(epLink, config.baseUrl).href,
                                    type: 'episode'
                                });
                            }
                        }
                    }
                }
                return episodes.length > 0 ? episodes : [{ name: 'Епізоди не знайдені', link: '#', type: 'info' }];
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
                const doc = this.parser.parseFromString(html, 'text/html');
                const videoLinks = [];

                // Пошук у <video> або iframe
                const videoEls = doc.querySelectorAll('video source');
                if (videoEls.length > 0) {
                    for (const source of videoEls) {
                        const file = source.getAttribute('src');
                        if (file) {
                            const type = file.endsWith('.m3u8') ? 'hls' : 'mp4';
                            videoLinks.push({ file, type });
                        }
                    }
                } else {
                    const iframeSrc = doc.querySelector('iframe')?.getAttribute('src');
                    if (iframeSrc) {
                        const iframeHtml = await this.fetchWithTimeout(iframeSrc);
                        const links = [
                            ...[...iframeHtml.matchAll(/file:\s*["'](.*?\.(?:mp4|m3u8))["']/g)].map(m => ({
                                file: m[1],
                                type: m[1].endsWith('.m3u8') ? 'hls' : 'mp4'
                            })),
                            ...[...iframeHtml.matchAll(/src=["'](.*?\.(?:mp4|m3u8))["']/g)].map(m => ({
                                file: m[1],
                                type: m[1].endsWith('.m3u8') ? 'hls' : 'mp4'
                            }))
                        ];
                        videoLinks.push(...links);
                    }
                }

                if (videoLinks.length > 0) {
                    localStorage.setItem(cacheKey, JSON.stringify(videoLinks));
                    return videoLinks;
                }
                return [{ file: '#', type: 'error', error: 'Відео не знайдено' }];
            } catch (error) {
                console.error('Помилка отримання відео:', error);
                return [];
            }
        }
    }

    // Ініціалізація плагіна
    function initializePlugin() {
        const api = new SeasonvarAPI();

        // Реєстрація джерела в Lampa
        if (typeof Lampa !== 'undefined' && Lampa.Source) {
            Lampa.Source.add('seasonvar', {
                title: 'Seasonvar',
                icon: `${config.baseUrl}/favicon.ico`,
                search: true,

                async onSearch(query, callback) {
                    const searchUrl = `${config.baseUrl}/search?query=${encodeURIComponent(query)}`;
                    const results = await api.getContent(searchUrl, `search_${query}`);
                    callback(results);
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
                    const results = await api.getContent(category.link, `category_${category.name}`);
                    callback(results);
                },

                async onMovie(movie, callback) {
                    const episodes = await api.getEpisodes(movie.link);
                    callback(episodes);
                },

                async onEpisode(episode, callback) {
                    const links = await api.getDirectVideoLink(episode.link);
                    callback(links);
                }
            });
        } else {
            console.error('Lampa API недоступне. Перевірте версію Lampa TV.');
        }
    }

    // Виконання ініціалізації
    try {
        initializePlugin();
    } catch (error) {
        console.error('Помилка ініціалізації плагіна Seasonvar:', error);
    }
})();
