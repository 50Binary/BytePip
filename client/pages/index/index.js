// index.js
// ==================== 配置区 ====================
// 在这里修改你的服务器地址（内网穿透地址）
const SERVER_URL = 'http://gc36dd98.natappfree.cc';  // ← 改成你的地址
// ==============================================

Page({
  data: {
    // 服务器配置（写死）
    serverUrl: SERVER_URL,
    connectionStatus: 'connecting', // connecting, connected, error
    
    // 文件相关
    files: [],
    uploading: false,
    
    // 文件菜单
    showFileMenu: false,
    selectedFile: null,
    selectedFileIndex: -1
  },

  onLoad() {
    // 页面加载时自动连接服务器
    this.checkConnection();
  },

  // 检查服务器连接
  checkConnection() {
    wx.request({
      url: `${this.data.serverUrl}/api/info`,
      timeout: 3000,
      success: (res) => {
        if (res.data && res.data.success) {
          this.setData({ connectionStatus: 'connected' });
          console.log('✅ 服务器连接成功');
        } else {
          this.setData({ connectionStatus: 'error' });
          console.error('❌ 服务器响应异常');
        }
      },
      fail: (err) => {
        this.setData({ connectionStatus: 'error' });
        console.error('❌ 服务器连接失败：', err);
        
        // 连接失败时提示用户
        wx.showToast({
          title: '无法连接到服务器',
          icon: 'none',
          duration: 3000
        });
      }
    });
  },

  // 选择文件
  chooseFromChat() {
    if (this.data.connectionStatus !== 'connected') {
      wx.showToast({
        title: '服务器未连接',
        icon: 'none'
      });
      return;
    }

    if (this.data.files.length >= 9) {
      wx.showToast({
        title: '最多只能选择9个文件',
        icon: 'none'
      });
      return;
    }

    wx.chooseMessageFile({
      count: 9 - this.data.files.length,
      type: 'all',
      success: (res) => {
        const newFiles = res.tempFiles.map(f => ({
          ...f,
          uploaded: false,
          progress: 0,
          sizeStr: this.formatSize(f.size)
        }));
        
        this.setData({
          files: [...this.data.files, ...newFiles]
        }, () => {
          // 自动开始上传新文件
          this.uploadFiles(newFiles);
        });
      }
    });
  },

  // 上传文件
  async uploadFiles(fileList) {
    this.setData({ uploading: true });

    for (let file of fileList) {
      try {
        await this.uploadSingleFile(file);
        
        const updatedFiles = this.data.files.map(f =>
          f.path === file.path ? { ...f, uploaded: true, progress: 100 } : f
        );
        this.setData({ files: updatedFiles });
      } catch (error) {
        console.error('上传失败：', error);
        wx.showToast({
          title: `${file.name} 上传失败`,
          icon: 'none'
        });
      }
    }

    this.setData({ uploading: false });
  },

  // 上传单个文件
  uploadSingleFile(file) {
    return new Promise((resolve, reject) => {
      const uploadTask = wx.uploadFile({
        url: `${this.data.serverUrl}/api/upload`,
        filePath: file.path,
        name: 'file',
        success: (res) => {
          if (res.statusCode === 200) {
            try {
              const data = JSON.parse(res.data);
              if (data.success) {
                resolve(data);
              } else {
                reject(new Error(data.error || '上传失败'));
              }
            } catch (e) {
              resolve(res.data);
            }
          } else {
            reject(new Error(`上传失败，状态码：${res.statusCode}`));
          }
        },
        fail: (err) => {
          console.error('上传请求失败：', err);
          reject(err);
        }
      });

      uploadTask.onProgressUpdate((res) => {
        const updatedFiles = this.data.files.map(f =>
          f.path === file.path ? { ...f, progress: res.progress } : f
        );
        this.setData({ files: updatedFiles });
      });
    });
  },

  // 上传全部文件
  uploadAllFiles() {
    const pendingFiles = this.data.files.filter(f => !f.uploaded);
    if (pendingFiles.length > 0) {
      this.uploadFiles(pendingFiles);
    }
  },

  // 删除文件
  removeFile(e) {
    const { index, name } = e.currentTarget.dataset;
    
    wx.showModal({
      title: '删除文件',
      content: `确定要删除 "${name}" 吗？`,
      success: (res) => {
        if (res.confirm) {
          const files = [...this.data.files];
          files.splice(index, 1);
          this.setData({ files });
        }
      }
    });
  },

  // 清空所有文件
  clearFiles() {
    if (this.data.files.length === 0) return;
    
    wx.showModal({
      title: '清空列表',
      content: '确定要清空所有文件吗？',
      success: (res) => {
        if (res.confirm) {
          this.setData({ files: [] });
        }
      }
    });
  },

  // 显示文件菜单
  showFileMenu(e) {
    const file = e.currentTarget.dataset.file;
    const index = e.currentTarget.dataset.index;
    this.setData({
      showFileMenu: true,
      selectedFile: file,
      selectedFileIndex: index
    });
  },

  // 关闭文件菜单
  closeFileMenu() {
    this.setData({
      showFileMenu: false,
      selectedFile: null,
      selectedFileIndex: -1
    });
  },

  // 重新上传
  retryUpload() {
    const { selectedFile, selectedFileIndex } = this.data;
    if (selectedFile && selectedFileIndex >= 0) {
      this.closeFileMenu();
      this.uploadFiles([selectedFile]);
    }
  },

  // 删除文件（从菜单）
  deleteFile() {
    const { selectedFile, selectedFileIndex } = this.data;
    if (selectedFile && selectedFileIndex >= 0) {
      wx.showModal({
        title: '删除文件',
        content: `确定要删除 "${selectedFile.name}" 吗？`,
        success: (res) => {
          if (res.confirm) {
            const files = [...this.data.files];
            files.splice(selectedFileIndex, 1);
            this.setData({ files });
          }
          this.closeFileMenu();
        }
      });
    }
  },

  // 分享文件
  shareFile() {
    const { selectedFile } = this.data;
    if (selectedFile) {
      wx.shareFileMessage({
        filePath: selectedFile.path,
        fileName: selectedFile.name,
        success: () => {
          this.closeFileMenu();
        },
        fail: (err) => {
          console.error('分享失败：', err);
          wx.showToast({
            title: '分享失败',
            icon: 'none'
          });
        }
      });
    }
  },

  // 获取文件图标
  getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const icons = {
      'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️', 'webp': '🖼️',
      'mp4': '🎬', 'mov': '🎬', 'avi': '🎬', 'mkv': '🎬',
      'mp3': '🎵', 'wav': '🎵', 'flac': '🎵',
      'pdf': '📕', 'doc': '📘', 'docx': '📘',
      'xls': '📊', 'xlsx': '📊', 'csv': '📊',
      'ppt': '📽️', 'pptx': '📽️',
      'zip': '🗜️', 'rar': '🗜️', '7z': '🗜️',
      'txt': '📄', 'md': '📄',
      'js': '⚙️', 'py': '⚙️', 'java': '⚙️', 'html': '🌐', 'css': '🎨',
      'exe': '⚡', 'dmg': '💿', 'apk': '📱'
    };
    return icons[ext] || '📄';
  },

  // 格式化文件大小
  formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  },

  // 是否有待上传文件
  get hasPendingFiles() {
    return this.data.files.some(f => !f.uploaded);
  },

  // 待上传文件数量
  get pendingCount() {
    return this.data.files.filter(f => !f.uploaded).length;
  }
});