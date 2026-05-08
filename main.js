const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const jschardet = require('jschardet')
const iconv = require('iconv-lite')

let mainWindow

// 配置目录路径
const configDir = path.join(app.getPath('userData'), 'config')
const excludeConfigDir = path.join(configDir, 'exclude_configs')
const indexFilePath = path.join(configDir, 'index.json')
const settingsFilePath = path.join(configDir, 'settings.json')

// 默认设置
const defaultSettings = {
  treeFormat: 0,           // 0: 树形符号, 1: 纯缩进, 2: Markdown
  filterPanelOpen: false,  // 排除文件类型面板是否展开
  windowSize: { width: 1200, height: 800 },
  windowPosition: { x: undefined, y: undefined }
}

// 初始化配置目录
function initConfigDir() {
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }
  if (!fs.existsSync(excludeConfigDir)) {
    fs.mkdirSync(excludeConfigDir, { recursive: true })
  }
  if (!fs.existsSync(indexFilePath)) {
    fs.writeFileSync(indexFilePath, JSON.stringify({}, null, 2))
  }
  if (!fs.existsSync(settingsFilePath)) {
    fs.writeFileSync(settingsFilePath, JSON.stringify(defaultSettings, null, 2))
  }
}

// 读取设置
function readSettings() {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFilePath, 'utf-8'))
    return { ...defaultSettings, ...settings }
  } catch {
    return { ...defaultSettings }
  }
}

// 保存设置
function saveSettings(settings) {
  fs.writeFileSync(settingsFilePath, JSON.stringify(settings, null, 2))
}

// 读取索引文件
function readIndex() {
  try {
    return JSON.parse(fs.readFileSync(indexFilePath, 'utf-8'))
  } catch {
    return {}
  }
}

// 保存索引文件
function saveIndex(index) {
  fs.writeFileSync(indexFilePath, JSON.stringify(index, null, 2))
}

// 获取下一个配置文件名
function getNextConfigFileName() {
  const files = fs.readdirSync(excludeConfigDir)
  const excludeFiles = files.filter(f => f.startsWith('exclude_') && f.endsWith('.json'))
  
  if (excludeFiles.length === 0) {
    return 'exclude_001.json'
  }
  
  const numbers = excludeFiles.map(f => {
    const match = f.match(/exclude_(\d+)\.json/)
    return match ? parseInt(match[1]) : 0
  })
  
  const maxNum = Math.max(...numbers)
  const nextNum = maxNum + 1
  return `exclude_${String(nextNum).padStart(3, '0')}.json`
}

// 加载排除配置
function loadExcludeConfig(filePath) {
  try {
    const configPath = path.join(excludeConfigDir, filePath)
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    }
  } catch (error) {
    console.error('Failed to load exclude config:', error)
  }
  return { excludedExtensions: [] }
}

// 保存排除配置
function saveExcludeConfig(filePath, config) {
  const configPath = path.join(excludeConfigDir, filePath)
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
}

function createWindow() {
  initConfigDir()
  
  const settings = readSettings()
  
  mainWindow = new BrowserWindow({
    width: settings.windowSize.width,
    height: settings.windowSize.height,
    x: settings.windowPosition.x,
    y: settings.windowPosition.y,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  mainWindow.loadFile('index.html')
  
  // 保存窗口位置和大小
  mainWindow.on('close', () => {
    const bounds = mainWindow.getBounds()
    settings.windowSize = { width: bounds.width, height: bounds.height }
    settings.windowPosition = { x: bounds.x, y: bounds.y }
    saveSettings(settings)
  })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// 选择文件夹
ipcMain.handle('select-folders', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'multiSelections']
  })
  return result.filePaths
})

// 选择文件
ipcMain.handle('select-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections']
  })
  return result.filePaths
})

// 获取目录树
ipcMain.handle('get-directory-tree', async (event, paths) => {
  const scanDirectory = (dirPath) => {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    const result = []

    entries.sort((a, b) => {
      if (a.isDirectory() === b.isDirectory()) {
        return a.name.localeCompare(b.name)
      }
      return a.isDirectory() ? -1 : 1
    })

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        result.push({
          name: entry.name,
          path: fullPath,
          is_dir: true,
          children: scanDirectory(fullPath)
        })
      } else {
        result.push({
          name: entry.name,
          path: fullPath,
          is_dir: false
        })
      }
    }

    return result
  }

  const trees = []
  for (const dirPath of paths) {
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      trees.push({
        name: path.basename(dirPath),
        path: dirPath,
        is_dir: true,
        children: scanDirectory(dirPath)
      })
    }
  }

  return trees
})

// 读取文件内容
ipcMain.handle('read-files', async (event, paths) => {
  const results = []

  for (const filePath of paths) {
    try {
      const buffer = fs.readFileSync(filePath)
      const detection = jschardet.detect(buffer)
      const encoding = detection.encoding || 'utf-8'
      
      let content
      try {
        content = iconv.decode(buffer, encoding.toLowerCase())
      } catch {
        content = buffer.toString('utf-8')
      }

      results.push({
        path: filePath,
        content,
        encoding: encoding.toUpperCase()
      })
    } catch (error) {
      results.push({
        path: filePath,
        content: `读取失败: ${error.message}`,
        encoding: 'unknown'
      })
    }
  }

  return results
})

// 加载文件夹的排除配置
ipcMain.handle('load-folder-exclude-config', async (event, folderPath) => {
  const index = readIndex()
  const configFileName = index[folderPath]
  
  if (configFileName) {
    return loadExcludeConfig(configFileName)
  }
  
  return { excludedExtensions: [], configFileName: null }
})

// 保存文件夹的排除配置
ipcMain.handle('save-folder-exclude-config', async (event, folderPath, excludedExtensions, excludedFolders, existingConfigFileName) => {
  const index = readIndex()
  let configFileName = existingConfigFileName
  
  // 如果没有现有配置文件，创建新的
  if (!configFileName) {
    configFileName = getNextConfigFileName()
    index[folderPath] = configFileName
    saveIndex(index)
  }
  
  // 保存排除配置
  saveExcludeConfig(configFileName, { excludedExtensions, excludedFolders })
  
  return { success: true, configFileName }
})

// 加载全局设置
ipcMain.handle('load-settings', async () => {
  return readSettings()
})

// 保存全局设置
ipcMain.handle('save-settings', async (event, settings) => {
  saveSettings(settings)
  return { success: true }
})
