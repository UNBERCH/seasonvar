(function() {
    'use strict';

    var Defined = {
        api: 'seasonvar', // Ідентифікатор для seasonvar.ru
        apiBaseUrl: 'https://cub.red/api/', // Базовий URL API
    };

    // Клас для роботи з мережею через API cub.red
    class CubRedNetwork {
        constructor() {
            this.net = new Lampa.Reguest();
            this.token = null; // Токен доступу
            this.profile = null; // Профіль користувача (опціонально)
        }

        // Встановлення таймауту
        timeout(time) {
            this.net.timeout(time);
        }

        // Установка токена та профілю
        setAuth(token, profile = null) {
            this.token = token;
            this.profile = profile;
        }

        // Виконання запиту до API
        async request(method, endpoint, data, params = {}) {
            if (!this.token) {
                throw new Error('Токен відсутній. Спочатку авторизуйтесь.');
            }

            const headers = {
                'Content-Type': 'application/json',
                'token': this.token
            };
            if (this.profile) {
                headers['profile'] = this.profile;
            }

            const url = `${Defined.apiBaseUrl}${endpoint}`;
            const options = {
                method: method.toUpperCase(),
                headers: headers,
                dataType: params.dataType || 'json',
                timeout: params.timeout || 10000
            };

            if (data && method.toUpperCase() === 'POST') {
                options.body = JSON.stringify(data);
            }

            try {
                const response = await this.net[method.toLowerCase()](url, options);
                return response;
            } catch (error) {
                console.error('Помилка запиту до API:', error);
                throw error;
            }
        }

        // Метод для тихих запитів
        silent(endpoint, success, error, data, params = {}) {
            this.request('GET', endpoint, null, params)
                .then(success)
                .catch(error);
        }

        // Метод для нативних запитів
        native(endpoint, success, error, data, params = {}) {
            this.request('POST', endpoint, data, params)
                .then(success)
                .catch(error);
        }

        clear() {
            this.net.clear();
        }
    }

    // Основний компонент для seasonvar.ru
    function SeasonvarComponent(object) {
        var network = new CubRedNetwork();
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var files = new Lampa.Explorer(object);
        var filter = new Lampa.Filter(object);
        var sources = {};
        var last;
        var source;
        var balanser;

        // Список джерел (балансерів), які підтримуються
        var balansers = ['seasonvar', 'kinopoisk', 'cubred'];

        // Авторизація через cub.red API
        async function authenticate(username, password) {
            try {
                const response = await network.request('POST', 'auth', {
                    username: username,
                    password: password
                });
                const token = response.token;
                const profile = response.profile || null;
                network.setAuth(token, profile);
                Lampa.Storage.set('seasonvar_token', token);
                Lampa.Storage.set('seasonvar_profile', profile);
                return token;
            } catch (error) {
                console.error('Помилка авторизації:', error);
                throw error;
            }
        }

        // Ініціалізація компонента
        this.initialize = async function() {
            this.loading(true);

            // Перевірка наявності токена
            const storedToken = Lampa.Storage.get('seasonvar_token', '');
            const storedProfile = Lampa.Storage.get('seasonvar_profile', '');
            if (storedToken) {
                network.setAuth(storedToken, storedProfile);
            } else {
                // Приклад авторизації (потрібно реалізувати UI для введення даних)
                await authenticate('example_user', 'example_password');
            }

            filter.onSearch = function(value) {
                Lampa.Activity.replace({
                    search: value,
                    clarification: true
                });
            };
            filter.onBack = this.start.bind(this);
            scroll.body().addClass('torrent-list');
            files.appendFiles(scroll.render());
            files.appendHead(filter.render());
            scroll.minus(files.render().find('.explorer__files-head'));
            scroll.body().append(Lampa.Template.get('lampac_content_loading'));

            this.loading(false);
            await this.fetchSources();
            this.search();
        };

        // Отримання доступних джерел
        this.fetchSources = async function() {
            try {
                const response = await network.request('GET', 'sources');
                // Припускаємо, що API повертає { sources: [{ name: "seasonvar", url: "..." }, ...] }
                response.sources.forEach(src => {
                    sources[src.name] = { url: src.url, name: src.name };
                });
                balanser = balansers[0]; // За замовчуванням seasonvar
                source = sources[balanser].url;
            } catch (error) {
                console.error('Не вдалося отримати джерела:', error);
                this.empty();
            }
        };

        // Пошук контенту
        this.search = function() {
            this.filter({ source: balansers }, this.getChoice());
            this.find();
        };

        this.find = function() {
            const url = this.requestParams(source);
            network.native(url, this.parse.bind(this), this.doesNotAnswer.bind(this), false, { dataType: 'json' });
        };

        // Формування параметрів запиту
        this.requestParams = function(url) {
            const query = [
                `id=${object.movie.id}`,
                `title=${encodeURIComponent(object.movie.title || object.movie.name)}`,
                `original_title=${encodeURIComponent(object.movie.original_title || object.movie.original_name)}`,
                `serial=${object.movie.name ? 1 : 0}`
            ];
            return url + (url.indexOf('?') >= 0 ? '&' : '?') + query.join('&');
        };

        // Парсинг відповіді від API
        this.parse = function(data) {
            // Припускаємо, що API повертає { videos: [{ url: "...", title: "...", season: 1, episode: 1 }], voices: [...] }
            const videos = data.videos || [];
            const voices = data.voices || [];
            if (videos.length) {
                this.display(videos);
            } else {
                this.empty();
            }
        };

        // Відображення відео
        this.display = function(videos) {
            scroll.clear();
            videos.forEach(video => {
                const item = {
                    title: video.title,
                    url: video.url,
                    season: video.season,
                    episode: video.episode
                };
                const html = Lampa.Template.get('lampac_prestige_full', item);
                html.on('hover:enter', () => {
                    Lampa.Player.play({ url: item.url, title: item.title });
                });
                scroll.append(html);
            });
            Lampa.Controller.enable('content');
        };

        // Помилка відповіді
        this.doesNotAnswer = function(error) {
            scroll.clear();
            scroll.append(Lampa.Template.get('lampac_does_not_answer', { balanser }));
            this.loading(false);
        };

        // Порожній результат
        this.empty = function() {
            scroll.clear();
            scroll.append(Lampa.Template.get('lampac_does_not_answer', { balanser }));
            this.loading(false);
        };

        this.loading = function(status) {
            if (status) this.activity.loader(true);
            else {
                this.activity.loader(false);
                this.activity.toggle();
            }
        };

        this.start = function() {
            Lampa.Controller.add('content', {
                toggle: () => {
                    Lampa.Controller.collectionSet(scroll.render(), files.render());
                    Lampa.Controller.collectionFocus(last || false, scroll.render());
                },
                back: this.back.bind(this)
            });
            Lampa.Controller.toggle('content');
        };

        this.back = function() {
            Lampa.Activity.backward();
        };

        this.render = function() {
            return files.render();
        };

        this.getChoice = function() {
            return { season: 0, voice: 0 }; // Заглушка для вибору
        };
    }

    // Запуск плагіна
    function startPlugin() {
        window.seasonvar_plugin = true;
        Lampa.Component.add('seasonvar', SeasonvarComponent);
        Lampa.Activity.push({
            url: '',
            title: 'Seasonvar Online',
            component: 'seasonvar',
            movie: { id: 1, title: 'Example', name: 'Example Series' }, // Приклад
            page: 1
        });
    }

    if (!window.seasonvar_plugin) startPlugin();
})();
