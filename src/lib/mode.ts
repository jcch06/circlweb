// Mode design local (?mock, dev uniquement) : les écritures restent locales
// (optimistes), aucun appel réseau. Lu une fois au chargement : la navigation
// interne perd le ?mock de l'URL mais le mode reste actif.
export const IS_MOCK = import.meta.env.DEV && new URLSearchParams(window.location.search).has('mock');
