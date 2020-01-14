import jsesc from 'jsesc';

// Server side data loading approach based on:
// https://ssr.vuejs.org/en/data.html#client-data-fetching

export default function initializeServer(createApp, serverOpts) {
    const opts = Object.assign({
        vuexModules: true,
        logger: console,
        preMiddleware: () => Promise.resolve(),
        middleware: () => Promise.resolve(),
        postMiddleware: () => Promise.resolve(),
    }, serverOpts);

    return context => new Promise((resolve, reject) => Promise.resolve()
        .then(() => opts.preMiddleware(context))
        .then(() => {
            // Initialize our app with proper request and translations
            const { app, router, store } = createApp(context);

            router.push(context.url);
            router.onReady(() => {
                const components = router.getMatchedComponents();

                if (!components.length) {
                    opts.logger.warn(`No matched components for route: ${context.request.url}`);
                    return reject({ code: 404, message: 'Not Found' });
                }

                if (opts.vuexModules) {
                    // Register any dynamic Vuex modules.  Registering the store
                    // modules as part of the component allows the module to be bundled
                    // with the async-loaded component and not in the initial root store
                    // bundle
                    components
                        .filter(c => 'vuex' in c)
                        .forEach((c) => {
                            // Allow a function to be passed that can generate a route-aware
                            // module name
                            const moduleName = typeof c.vuex.moduleName === 'function' ?
                                c.vuex.moduleName({ $route: router.currentRoute }) :
                                c.vuex.moduleName;
                            opts.logger.info('Registering dynamic Vuex module:', moduleName);
                            store.registerModule(moduleName, c.vuex.module, {
                                preserveState: store.state[moduleName] != null,
                            });
                        });
                }

                const fetchData = c => c.fetchData && c.fetchData({
                    ssrContext: context,
                    app,
                    route: router.currentRoute,
                    router,
                    store,
                });

                // Execute all provided middleware prior to fetchData
                return Promise.resolve()
                    .then(() => opts.middleware(context, app, router, store))
                    .then(() => Promise.all(components.map(fetchData)))
                    .then(() => opts.postMiddleware(context, app, router, store))
                    // Set initialState and translations to be embedded into
                    // the template for client hydration
                    .then(() => Object.assign(context, {
                        // Stringify so we can use JSON.parse for performance.
                        //   Double stringify to properly escape characters. See:
                        //   https://v8.dev/blog/cost-of-javascript-2019#json
                        //   using jsesc for second stringify to help protect against XSS attacks
                        //   https://gist.github.com/mathiasbynens/d6e10171d44a59bb5664617c64ff2763#file-escape-js-L15
                        //   https://github.com/mathiasbynens/jsesc#isscriptcontext
                        initialState: jsesc(JSON.stringify(store.state,
                            (k, v) => (v === undefined ? null : v)), {
                            quotes: 'double',
                            json: true,
                            isScriptContext: true,
                        }),
                    }))
                    .then(() => resolve(app))
                    .catch((e) => {
                        opts.logger.error('Error in middleware chain');
                        opts.logger.error(e);
                        return reject(e || new Error('Unknown Error from middleware'));
                    });
            }, (e) => {
                opts.logger.error('Router rejected onReady callback');
                opts.logger.error(e);
                return reject(e || new Error('Unknown Error from onReady'));
            });
        })
        .catch((e) => {
            opts.logger.error('Error in preMiddleware chain');
            opts.logger.error(e);
            return reject(e || new Error('Unknown Error from preMiddleware'));
        }));
}
