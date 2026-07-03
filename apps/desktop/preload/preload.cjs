const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  // Command registry & execution
  commands: {
    getRegistry: () => ipcRenderer.invoke('desktop:getCommandRegistry'),
    run: (payload) => ipcRenderer.invoke('desktop:runCommand', payload),
    cancel: (runId) => ipcRenderer.invoke('desktop:cancelCommand', runId),
    getHistory: (query) => ipcRenderer.invoke('desktop:getCommandHistory', query),
  },

  // Account management
  accounts: {
    list: () => ipcRenderer.invoke('desktop:listAccounts'),
    add: (params) => ipcRenderer.invoke('desktop:addAccount', params),
    update: (profile, params) => ipcRenderer.invoke('desktop:updateAccount', profile, params),
    remove: (profile) => ipcRenderer.invoke('desktop:removeAccount', profile),
    setActive: (profile) => ipcRenderer.invoke('desktop:setActiveAccount', profile),
    login: (profile) => ipcRenderer.invoke('desktop:loginAccount', profile),
    loginInTerminal: (profile) => ipcRenderer.invoke('desktop:loginAccountInTerminal', profile),
    loginManyInTerminal: (profiles) => ipcRenderer.invoke('desktop:loginAccountsInTerminal', profiles),
    loginBrowser: (profile) => ipcRenderer.invoke('desktop:loginAccountBrowser', profile),
    loginManyBrowser: (profiles) => ipcRenderer.invoke('desktop:loginAccountsBrowser', profiles),
    refreshStatus: (profile) => ipcRenderer.invoke('desktop:refreshAccountStatus', profile),
    suggestProfileName: () => ipcRenderer.invoke('desktop:suggestProfileName'),
  },

  // Runtime
  runtime: {
    getStatus: (profile) => ipcRenderer.invoke('desktop:getRuntimeStatus', profile),
    doctor: (profile) => ipcRenderer.invoke('desktop:doctor', profile),
    getCliInfo: () => ipcRenderer.invoke('desktop:getCliInfo'),
  },

  // Product history
  productHistory: {
    list: (limit) => ipcRenderer.invoke('desktop:listProductHistory', limit),
    add: (products, meta) => ipcRenderer.invoke('desktop:addProductsToHistory', products, meta),
    clear: () => ipcRenderer.invoke('desktop:clearProductHistory'),
  },

  // File utilities
  files: {
    writeTempImage: (base64, contentType) => ipcRenderer.invoke('desktop:writeTempImage', { base64, contentType }),
  },

  // Ozon AI drafts and submit
  ozon: {
    getSettings: () => ipcRenderer.invoke('desktop:getOzonSettings'),
    saveSettings: (patch) => ipcRenderer.invoke('desktop:saveOzonSettings', patch),
    getStoreStats: () => ipcRenderer.invoke('desktop:getOzonStoreStats'),
    getCategoryTree: (options) => ipcRenderer.invoke('desktop:getOzonCategoryTree', options),
    searchCategories: (query, options) => ipcRenderer.invoke('desktop:searchOzonCategories', query, options),
    getCategoryAttributes: (params) => ipcRenderer.invoke('desktop:getOzonCategoryAttributes', params),
    getCategoryAttributeValues: (params) => ipcRenderer.invoke('desktop:getOzonCategoryAttributeValues', params),
    generateDraft: (rows) => ipcRenderer.invoke('desktop:generateOzonDraft', rows),
    generateAttributeSuggestions: (params) => ipcRenderer.invoke('desktop:generateOzonAttributeSuggestions', params),
    submitDraft: (draft, confirmed) => ipcRenderer.invoke('desktop:submitOzonDraft', draft, confirmed),
  },
});
