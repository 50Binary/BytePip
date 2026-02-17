const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

// ==================== 配置 ====================
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const CONFIG_FILE = path.join(__dirname, 'server-config.json');

// 确保上传目录存在
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ==================== 配置文件管理 ====================
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (err) {
    console.log('未找到配置文件，使用默认配置');
  }
  
  // 默认配置
  return {
    computerName: os.hostname(),
    savePath: UPLOAD_DIR,
    maxFileSize: 100 * 1024 * 1024, // 100MB
    allowTypes: ['*'], // 允许所有类型
    createdAt: new Date().toISOString()
  };
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

const config = loadConfig();

// ==================== 文件上传配置 ====================
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // 按日期分文件夹保存
    const dateDir = path.join(UPLOAD_DIR, new Date().toISOString().split('T')[0]);
    if (!fs.existsSync(dateDir)) {
      fs.mkdirSync(dateDir, { recursive: true });
    }
    cb(null, dateDir);
  },
  filename: function (req, file, cb) {
    // 生成唯一文件名：时间戳_随机数_原文件名
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex');
    const safeName = file.originalname.replace(/[^a-zA-Z0-9\u4e00-\u9fa5.]/g, '_');
    cb(null, `${timestamp}_${random}_${safeName}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: config.maxFileSize },
  fileFilter: (req, file, cb) => {
    // 如果配置了允许类型且不是通配符，则检查
    if (config.allowTypes[0] !== '*') {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!config.allowTypes.includes(ext)) {
        return cb(new Error(`不支持的文件类型: ${ext}`), false);
      }
    }
    cb(null, true);
  }
});

// ==================== 中间件 ====================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 请求日志中间件
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleString()}] ${req.method} ${req.url} - ${req.ip}`);
  next();
});

// ==================== API 路由 ====================

/**
 * 1. 获取服务器信息（小程序端调用）
 */
app.get('/api/info', (req, res) => {
  res.json({
    success: true,
    server: {
      name: config.computerName,
      version: '1.0.0',
      maxFileSize: config.maxFileSize,
      savePath: config.savePath,
      uptime: process.uptime()
    }
  });
});

/**
 * 2. 生成连接二维码（返回纯数据，不返回HTML）
 */
app.get('/api/qrcode', async (req, res) => {
  try {
    // 获取本机IP（局域网用）
    const localIP = getLocalIP();
    
    // 构建二维码数据
    const qrData = {
      server: `http://${localIP}:${PORT}`,
      name: config.computerName,
      time: Date.now(),
      type: 'file-transfer'
    };
    
    // 将对象转为字符串
    const qrString = JSON.stringify(qrData);
    
    // 生成二维码DataURL
    const qrCode = await QRCode.toDataURL(qrString);
    
    res.json({
      success: true,
      qrCode: qrCode,
      data: qrData,
      text: qrString  // 纯文本形式，方便调试
    });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: '生成二维码失败',
      message: err.message 
    });
  }
});

/**
 * 3. 上传文件接口（小程序调用）
 */
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ 
      success: false, 
      error: '没有收到文件' 
    });
  }

  const fileInfo = {
    id: crypto.randomBytes(8).toString('hex'),
    name: req.file.originalname,
    savedName: req.file.filename,
    size: req.file.size,
    sizeStr: formatFileSize(req.file.size),
    path: req.file.path,
    time: Date.now(),
    timeStr: new Date().toLocaleString()
  };

  console.log(`✅ 收到文件: ${fileInfo.name} (${fileInfo.sizeStr})`);

  res.json({
    success: true,
    message: '文件上传成功',
    file: fileInfo
  });
});

/**
 * 4. 批量上传接口（支持多文件）
 */
app.post('/api/upload-multiple', upload.array('files', 10), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ 
      success: false, 
      error: '没有收到文件' 
    });
  }

  const files = req.files.map(file => ({
    id: crypto.randomBytes(8).toString('hex'),
    name: file.originalname,
    savedName: file.filename,
    size: file.size,
    sizeStr: formatFileSize(file.size),
    path: file.path,
    time: Date.now()
  }));

  console.log(`✅ 收到 ${files.length} 个文件`);

  res.json({
    success: true,
    message: `成功上传 ${files.length} 个文件`,
    files: files
  });
});

/**
 * 5. 获取文件列表
 */
app.get('/api/files', (req, res) => {
  const { date, limit = 50 } = req.query;
  const fileList = [];
  
  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;
    
    const items = fs.readdirSync(dir);
    items.forEach(item => {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isFile()) {
        // 解析文件名：时间戳_随机数_原文件名
        const match = item.match(/^(\d+)_[a-f0-9]+_(.+)$/);
        const originalName = match ? match[2] : item;
        const fileTime = match ? parseInt(match[1]) : stat.mtimeMs;
        
        fileList.push({
          id: crypto.createHash('md5').update(fullPath).digest('hex').substr(0, 16),
          name: originalName,
          savedName: item,
          size: stat.size,
          sizeStr: formatFileSize(stat.size),
          path: path.relative(UPLOAD_DIR, fullPath),
          time: fileTime,
          timeStr: new Date(fileTime).toLocaleString()
        });
      }
    });
  }

  // 如果指定了日期，只扫描该日期目录
  if (date) {
    scanDir(path.join(UPLOAD_DIR, date));
  } else {
    // 否则扫描所有日期目录
    const dirs = fs.readdirSync(UPLOAD_DIR)
      .filter(d => fs.statSync(path.join(UPLOAD_DIR, d)).isDirectory())
      .sort()
      .reverse();
    
    dirs.forEach(dir => scanDir(path.join(UPLOAD_DIR, dir)));
  }

  // 按时间倒序排序
  fileList.sort((a, b) => b.time - a.time);
  
  // 限制数量
  const limitedList = fileList.slice(0, parseInt(limit));

  res.json({
    success: true,
    total: fileList.length,
    returned: limitedList.length,
    files: limitedList,
    savePath: UPLOAD_DIR
  });
});

/**
 * 6. 下载文件
 */
app.get('/api/download/:date/:filename', (req, res) => {
  const { date, filename } = req.params;
  const filePath = path.join(UPLOAD_DIR, date, filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ 
      success: false, 
      error: '文件不存在' 
    });
  }

  // 解析原文件名用于下载
  const match = filename.match(/^\d+_[a-f0-9]+_(.+)$/);
  const downloadName = match ? match[1] : filename;

  res.download(filePath, downloadName);
});

/**
 * 7. 删除文件
 */
app.delete('/api/files/:date/:filename', (req, res) => {
  const { date, filename } = req.params;
  const filePath = path.join(UPLOAD_DIR, date, filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ 
      success: false, 
      error: '文件不存在' 
    });
  }

  try {
    fs.unlinkSync(filePath);
    console.log(`🗑️ 删除文件: ${filename}`);
    res.json({ 
      success: true, 
      message: '文件已删除' 
    });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: '删除失败',
      message: err.message 
    });
  }
});

/**
 * 8. 获取服务器统计信息
 */
app.get('/api/stats', (req, res) => {
  let totalFiles = 0;
  let totalSize = 0;
  
  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;
    
    const items = fs.readdirSync(dir);
    items.forEach(item => {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isFile()) {
        totalFiles++;
        totalSize += stat.size;
      } else if (stat.isDirectory()) {
        scanDir(fullPath);
      }
    });
  }
  
  scanDir(UPLOAD_DIR);

  res.json({
    success: true,
    stats: {
      totalFiles,
      totalSize,
      totalSizeStr: formatFileSize(totalSize),
      savePath: UPLOAD_DIR,
      freeSpace: formatFileSize(getFreeDiskSpace(UPLOAD_DIR)),
      serverUptime: formatUptime(process.uptime()),
      config: {
        computerName: config.computerName,
        maxFileSize: config.maxFileSize,
        maxFileSizeStr: formatFileSize(config.maxFileSize)
      }
    }
  });
});

/**
 * 9. 健康检查
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    time: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// ==================== 辅助函数 ====================

// 获取本机IP
function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

// 格式化文件大小
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 格式化运行时间
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0) parts.push(`${hours}小时`);
  if (minutes > 0) parts.push(`${minutes}分钟`);
  if (secs > 0) parts.push(`${secs}秒`);
  
  return parts.join('');
}

// 获取磁盘剩余空间
function getFreeDiskSpace(dir) {
  try {
    const stats = fs.statfsSync(dir);
    return stats.bfree * stats.bsize;
  } catch (err) {
    return 0;
  }
}

// ==================== 启动服务器 ====================
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n' + '='.repeat(50));
  console.log('🚀 文件传输服务器启动成功');
  console.log('='.repeat(50));
  console.log(`📡 局域网地址: http://${getLocalIP()}:${PORT}`);
  console.log(`💻 电脑名称: ${config.computerName}`);
  console.log(`📁 保存路径: ${UPLOAD_DIR}`);
  console.log(`📦 最大文件: ${formatFileSize(config.maxFileSize)}`);
  console.log('='.repeat(50));
  console.log('\n可用接口:');
  console.log('  GET  /api/info            - 服务器信息');
  console.log('  GET  /api/qrcode          - 获取二维码数据');
  console.log('  POST /api/upload          - 上传单个文件');
  console.log('  POST /api/upload-multiple - 批量上传文件');
  console.log('  GET  /api/files           - 文件列表');
  console.log('  GET  /api/stats            - 服务器统计');
  console.log('  GET  /api/health           - 健康检查');
  console.log('='.repeat(50));
});