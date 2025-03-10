// Плагін для Seasonvar.ru для Lampa TV
(function () {
    'use strict';

    // Конфігурація плагіна
    var plugin = {
        url: 'http://seasonvar.ru',
        name: 'Seasonvar',
        version: '1.0.1',
        author: 'Grok'
    };

    // Утилітарна функція для HTTP-запитів
    function request(url, callback) {
        Lampa.Utils.get({
            url: url,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        }, function (response) {
            if (response && response.status == 200) {
                callback(response.body);
            } else {
                Lampa.Noty.show('Помилка завантаження даних із Seasonvar');
                callback(null);
            }
        }, function () {
            Lampa.Noty.show('Не вдалося підключитися до Seasonvar');
            callback(null);
        });
    }

    // Парсинг каталогу
    function parseCatalog(html) {
        if (!html) return [];

        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');
        var items = [];

        // Припускаємо, що список серіалів у блоці з класом '.pgs-serials-list'
        var elements = doc.querySelectorAll('.pgs-serials-list .film-list-item') || [];
        elements.forEach(function (el) {
            var title = el.querySelector('.film-title')?.textContent.trim() || 'Без назви';
            var link = plugin.url + (el.querySelector('a')?.getAttribute('href') || '');
            var img = el.querySelector('img')?.getAttribute('src') || '';

            items.push({
                title: title,
                url: link,
                poster: img.startsWith('http') ? img : plugin.url + img,
                type: 'serial'
            });
        });

        return items;
    }

    // Парсинг сторінки серіалу
    function parseItem(html, url) {
        if (!html) return null;

        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');

        var title = doc.querySelector('.pgs-seria-head h1')?.textContent.trim() || 'Без назви';
        var seasons = [];
        var seasonElements = doc.querySelectorAll('.season-block') || [];

        seasonElements.forEach(function (seasonEl, seasonIndex) {
            var episodes = [];
            var episodeElements = seasonEl.querySelectorAll('.episode-item') || [];

            episodeElements.forEach(function (epEl) {
                var epTitle = epEl.querySelector('.episode-title')?.textContent.trim() || 'Епізод';
                var epLink = epEl.querySelector('a')?.getAttribute('href') || '';
                epLink = epLink.startsWith('http') ? epLink : plugin.url + epLink;

                episodes.push({
                    title: epTitle,
                    url: epLink
                });
            });

            seasons.push({
                season: seasonIndex + 1,
                episodes: episodes
            });
        });

        return {
            title: title,
            seasons: seasons,
            url: url
        };
    }

    // Реєстрація плагіна
    Lampa.Plugin.register({
        name: plugin.name,
        version: plugin.version,
        author: plugin.author,

        // Каталог серіалів
        catalog: function (params, callback) {
            request(plugin.url, function (html) {
                callback(parseCatalog(html));
            });
        },

        // Деталі серіалу
        item: function (url, callback) {
            request(url, function (html) {
                callback(parseItem(html, url));
            });
        },

        // Пошук
        search: function (query, callback) {
            var searchUrl = plugin.url + '/search?q=' + encodeURIComponent(query);
            request(searchUrl, function (html) {
                callback(parseCatalog(html));
            });
        }
    });

    Lampa.Noty.show('Плагін Seasonvar завантажено!');
})();