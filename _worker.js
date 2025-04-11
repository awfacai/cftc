async function initDatabase(config) {
    console.log("开始数据库初始化...");
    if (!config || !config.database) {
      console.error("数据库配置缺失");
      throw new Error("数据库配置无效，请检查D1数据库是否正确绑定");
    }
    
    // 初始化缓存 - 使用非全局方式，避免Worker环境问题
    if (!config.fileCache) {
      config.fileCache = new Map();
      config.fileCacheTTL = 3600000; // 1小时缓存过期时间
    }
    
    const maxRetries = 3;
    let lastError = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`正在测试数据库连接... (尝试 ${attempt}/${maxRetries})`);
        await config.database.prepare("SELECT 1").run();
        console.log("数据库连接成功");
        console.log("正在验证数据库结构...");
        const structureValid = await validateDatabaseStructure(config);
        if (!structureValid) {
          throw new Error("数据库结构验证失败");
        }
        console.log("数据库初始化成功");
        return true;
      } catch (error) {
        lastError = error;
        console.error(`数据库初始化尝试 ${attempt} 失败:`, error);
        if (error.message.includes('no such table')) {
          console.log("检测到数据表不存在，尝试创建...");
          try {
            await recreateAllTables(config);
            console.log("数据表创建成功");
            return true;
          } catch (tableError) {
            console.error("创建数据表失败:", tableError);
          }
        }
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          console.log(`等待 ${delay}ms 后重试...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    throw new Error(`数据库初始化失败 (${maxRetries} 次尝试): ${lastError?.message || '未知错误'}`);
  }
  async function recreateAllTables(config) {
    try {
      await config.database.prepare(`
        CREATE TABLE IF NOT EXISTS categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
      await config.database.prepare(`
        CREATE TABLE IF NOT EXISTS user_settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chat_id TEXT NOT NULL UNIQUE,
          storage_type TEXT DEFAULT 'telegram',
          current_category_id INTEGER,
          waiting_for TEXT,
          editing_file_id TEXT,
          FOREIGN KEY (current_category_id) REFERENCES categories(id)
        )
      `).run();
      await config.database.prepare(`
        CREATE TABLE IF NOT EXISTS files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          url TEXT NOT NULL,
          fileId TEXT,
          message_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          file_name TEXT,
          file_size INTEGER,
          mime_type TEXT,
          storage_type TEXT DEFAULT 'telegram',
          category_id INTEGER,
          chat_id TEXT,
          FOREIGN KEY (category_id) REFERENCES categories(id)
        )
      `).run();
      await config.database.prepare(`
        INSERT OR IGNORE INTO categories (name) VALUES ('默认分类')
      `).run();
      return true;
    } catch (error) {
      console.error("重新创建表失败:", error);
      throw error;
    }
  }
  async function validateDatabaseStructure(config) {
    try {
      const tables = ['categories', 'user_settings', 'files'];
      for (const table of tables) {
        try {
          await config.database.prepare(`SELECT 1 FROM ${table} LIMIT 1`).run();
        } catch (error) {
          if (error.message.includes('no such table')) {
            console.log(`表 ${table} 不存在，尝试重新创建所有表...`);
            await recreateAllTables(config);
            return true;
          }
          throw error;
        }
      }
      const tableStructures = {
        categories: [
          { name: 'id', type: 'INTEGER' },
          { name: 'name', type: 'TEXT' },
          { name: 'created_at', type: 'DATETIME' }
        ],
        user_settings: [
          { name: 'id', type: 'INTEGER' },
          { name: 'chat_id', type: 'TEXT' },
          { name: 'storage_type', type: 'TEXT' },
          { name: 'current_category_id', type: 'INTEGER' },
          { name: 'waiting_for', type: 'TEXT' },
          { name: 'editing_file_id', type: 'TEXT' }
        ],
        files: [
          { name: 'id', type: 'INTEGER' },
          { name: 'url', type: 'TEXT' },
          { name: 'fileId', type: 'TEXT' },
          { name: 'message_id', type: 'INTEGER' },
          { name: 'created_at', type: 'DATETIME' },
          { name: 'file_name', type: 'TEXT' },
          { name: 'file_size', type: 'INTEGER' },
          { name: 'mime_type', type: 'TEXT' },
          { name: 'storage_type', type: 'TEXT' },
          { name: 'category_id', type: 'INTEGER' },
          { name: 'chat_id', type: 'TEXT' }
        ]
      };
      for (const [table, expectedColumns] of Object.entries(tableStructures)) {
        const tableInfo = await config.database.prepare(`PRAGMA table_info(${table})`).all();
        const actualColumns = tableInfo.results;
        for (const expectedColumn of expectedColumns) {
          const found = actualColumns.some(col => 
            col.name.toLowerCase() === expectedColumn.name.toLowerCase() &&
            col.type.toUpperCase().includes(expectedColumn.type)
          );
          if (!found) {
            console.log(`表 ${table} 缺少列 ${expectedColumn.name}，尝试添加...`);
            try {
              await config.database.prepare(`ALTER TABLE ${table} ADD COLUMN ${expectedColumn.name} ${expectedColumn.type}`).run();
    } catch (error) {
              if (!error.message.includes('duplicate column name')) {
                throw error;
              }
            }
          }
        }
      }
      console.log('检查默认分类...');
      const defaultCategory = await config.database.prepare('SELECT id FROM categories WHERE name = ?')
        .bind('默认分类').first();
      if (!defaultCategory) {
        console.log('默认分类不存在，正在创建...');
        try {
          const result = await config.database.prepare('INSERT INTO categories (name, created_at) VALUES (?, ?)')
            .bind('默认分类', Date.now()).run();
          const newDefaultId = result.meta && result.meta.last_row_id;
          console.log(`默认分类创建成功，ID: ${newDefaultId}`);
          if (newDefaultId) {
            const filesResult = await config.database.prepare('SELECT COUNT(*) as count FROM files WHERE category_id IS NULL').first();
            if (filesResult && filesResult.count > 0) {
              console.log(`发现 ${filesResult.count} 个无分类文件，将它们分配到默认分类...`);
              await config.database.prepare('UPDATE files SET category_id = ? WHERE category_id IS NULL')
                .bind(newDefaultId).run();
            }
            const settingsResult = await config.database.prepare('SELECT COUNT(*) as count FROM user_settings WHERE current_category_id IS NULL').first();
            if (settingsResult && settingsResult.count > 0) {
              console.log(`发现 ${settingsResult.count} 条用户设置没有当前分类，更新为默认分类...`);
              await config.database.prepare('UPDATE user_settings SET current_category_id = ? WHERE current_category_id IS NULL')
                .bind(newDefaultId).run();
            }
          }
        } catch (error) {
          console.error('创建默认分类失败:', error);
          throw new Error('无法创建默认分类: ' + error.message);
        }
      } else {
        console.log(`默认分类存在，ID: ${defaultCategory.id}`);
      }
      const checkAgain = await config.database.prepare('SELECT id FROM categories WHERE name = ?')
        .bind('默认分类').first();
      if (!checkAgain) {
        throw new Error('验证失败：即使尝试创建后，默认分类仍然不存在');
      }
      return true;
    } catch (error) {
      console.error('验证数据库结构时出错:', error);
      return false;
    }
  }
  async function recreateCategoriesTable(config) {
    try {
      const existingData = await config.database.prepare('SELECT * FROM categories').all();
      await config.database.prepare('DROP TABLE IF EXISTS categories').run();
      await config.database.prepare(`
        CREATE TABLE categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          created_at INTEGER NOT NULL
        )
      `).run();
      if (existingData && existingData.results && existingData.results.length > 0) {
        for (const row of existingData.results) {
          await config.database.prepare('INSERT OR IGNORE INTO categories (id, name, created_at) VALUES (?, ?, ?)')
            .bind(row.id || null, row.name || '未命名分类', row.created_at || Date.now()).run();
        }
        console.log(`已恢复 ${existingData.results.length} 个分类数据`);
      }
      console.log("分类表重建完成");
    } catch (error) {
      console.error(`重建分类表失败: ${error.message}`);
    }
  }
  async function recreateUserSettingsTable(config) {
    try {
      await config.database.prepare('DROP TABLE IF EXISTS user_settings').run();
      await config.database.prepare(`
        CREATE TABLE user_settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chat_id TEXT NOT NULL UNIQUE,
          storage_type TEXT DEFAULT 'r2',
          category_id INTEGER,
          custom_suffix TEXT,
          waiting_for TEXT,
          editing_file_id TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
      console.log('用户设置表重新创建成功');
      return true;
    } catch (error) {
      console.error('重新创建用户设置表失败:', error);
      return false;
    }
  }
  async function recreateFilesTable(config) {
    console.log('开始重建文件表...');
    try {
      console.log('备份现有数据...');
      const existingData = await config.database.prepare('SELECT * FROM files').all();
      console.log('删除现有表...');
      await config.database.prepare('DROP TABLE IF EXISTS files').run();
      console.log('创建新表...');
      await config.database.prepare(`
        CREATE TABLE files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          url TEXT NOT NULL,
          fileId TEXT NOT NULL,
          message_id INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          file_name TEXT,
          file_size INTEGER,
          mime_type TEXT,
          chat_id TEXT,
          storage_type TEXT NOT NULL DEFAULT 'telegram',
          category_id INTEGER,
          custom_suffix TEXT,
          FOREIGN KEY (category_id) REFERENCES categories(id)
        )
      `).run();
      console.log('恢复数据...');
      if (existingData && existingData.results && existingData.results.length > 0) {
        console.log(`恢复 ${existingData.results.length} 条记录...`);
        for (const row of existingData.results) {
          const timestamp = row.created_at || Math.floor(Date.now() / 1000);
          const messageId = row.message_id || 0;
          try {
            await config.database.prepare(`
              INSERT INTO files (
                url, fileId, message_id, created_at, file_name, file_size, 
                mime_type, chat_id, storage_type, category_id, custom_suffix
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
              row.url, 
              row.fileId || row.url, 
              messageId,
              timestamp,
              row.file_name, 
              row.file_size, 
              row.mime_type, 
              row.chat_id, 
              row.storage_type || 'telegram', 
              row.category_id,
              row.custom_suffix
            ).run();
          } catch (e) {
            console.error(`恢复记录失败: ${e.message}`, row);
          }
        }
      }
      console.log('文件表重建完成!');
      return true;
    } catch (error) {
      console.error('重建文件表失败:', error);
      return false;
    }
  }
  async function checkAndAddMissingColumns(config) {
    try {
      await ensureColumnExists(config, 'files', 'custom_suffix', 'TEXT');
      await ensureColumnExists(config, 'files', 'chat_id', 'TEXT');
      await ensureColumnExists(config, 'user_settings', 'custom_suffix', 'TEXT');
      await ensureColumnExists(config, 'user_settings', 'waiting_for', 'TEXT');
      await ensureColumnExists(config, 'user_settings', 'editing_file_id', 'TEXT');
      await ensureColumnExists(config, 'user_settings', 'current_category_id', 'INTEGER');
      return true;
    } catch (error) {
      console.error('检查并添加缺失列失败:', error);
      return false;
    }
  }
  async function ensureColumnExists(config, tableName, columnName, columnType) {
    console.log(`确保列 ${columnName} 存在于表 ${tableName} 中...`); 
    try {
      console.log(`检查列 ${columnName} 是否存在于 ${tableName}...`); 
      const tableInfo = await config.database.prepare(`PRAGMA table_info(${tableName})`).all();
      const columnExists = tableInfo.results.some(col => col.name === columnName);
      if (columnExists) {
        console.log(`列 ${columnName} 已存在于表 ${tableName} 中`);
        return true; 
      }
      console.log(`列 ${columnName} 不存在于表 ${tableName}，尝试添加...`); 
      try {
        await config.database.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`).run();
        console.log(`列 ${columnName} 已成功添加到表 ${tableName}`);
        return true; 
      } catch (alterError) {
        console.warn(`添加列 ${columnName} 到 ${tableName} 时发生错误: ${alterError.message}. 尝试再次检查列是否存在...`, alterError); 
        const tableInfoAfterAttempt = await config.database.prepare(`PRAGMA table_info(${tableName})`).all();
        if (tableInfoAfterAttempt.results.some(col => col.name === columnName)) {
           console.log(`列 ${columnName} 在添加尝试失败后被发现存在于表 ${tableName} 中。`);
           return true; 
        } else {
           console.error(`添加列 ${columnName} 到 ${tableName} 失败，并且再次检查后列仍不存在。`);
           return false; 
        }
      }
    } catch (error) {
      console.error(`检查或添加表 ${tableName} 中的列 ${columnName} 时发生严重错误: ${error.message}`, error);
      return false; 
    }
  }
  async function setWebhook(webhookUrl, botToken) {
    // 如果没有配置Telegram机器人令牌，跳过设置webhook
    if (!botToken) {
      console.log('未配置Telegram机器人令牌，跳过webhook设置');
      return true;
    }
    
    const maxRetries = 3;
    let retryCount = 0;
    while (retryCount < maxRetries) {
      try {
        console.log(`尝试设置webhook: ${webhookUrl}`);
        const response = await fetch(
          `https://api.telegram.org/bot${botToken}/setWebhook?url=${webhookUrl}`
        );
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Telegram API错误: HTTP ${response.status} - ${errorText}`);
          retryCount++;
          continue;
        }
        
        const result = await response.json();
        if (!result.ok) {
          if (result.error_code === 429) {
            const retryAfter = result.parameters?.retry_after || 1;
            console.log(`请求频率限制，等待 ${retryAfter} 秒后重试...`);
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            retryCount++;
            continue;
          }
          console.error(`设置webhook失败: ${JSON.stringify(result)}`);
          return false;
        }
        console.log(`Webhook设置成功: ${webhookUrl}`);
      return true;
    } catch (error) {
        console.error(`设置webhook时出错: ${error.message}`);
        retryCount++;
        if (retryCount < maxRetries) {
          const delay = 1000 * Math.pow(2, retryCount);
          console.log(`等待 ${delay}ms 后重试...`);
          await new Promise(resolve => setTimeout(resolve, delay)); 
        }
      }
    }
    console.error('多次尝试后仍未能设置webhook');
    return false;
  }
  export default {
    async fetch(request, env) {
      // 检查并设置必要的环境变量
      if (!env.DATABASE) {
        console.error("缺少DATABASE配置");
        return new Response('缺少必要配置: DATABASE 环境变量未设置', { status: 500 });
      }
      
      const config = {
        domain: env.DOMAIN || request.headers.get("host") || '',
        database: env.DATABASE,
        username: env.USERNAME || '',
        password: env.PASSWORD || '',
        enableAuth: env.ENABLE_AUTH === 'true' || false,
        tgBotToken: env.TG_BOT_TOKEN || '',
        tgChatId: env.TG_CHAT_ID ? env.TG_CHAT_ID.split(",") : [],
        tgStorageChatId: env.TG_STORAGE_CHAT_ID || env.TG_CHAT_ID || '',
        cookie: Number(env.COOKIE) || 7,
        maxSizeMB: Number(env.MAX_SIZE_MB) || 20,
        bucket: env.BUCKET,
        fileCache: new Map(),
        fileCacheTTL: 3600000 // 1小时缓存
      };
      
      // 确保认证配置有效
      if (config.enableAuth) {
        if (!config.username || !config.password) {
          console.error("启用了认证但未配置用户名或密码");
          return new Response('认证配置错误: 缺少USERNAME或PASSWORD环境变量', { status: 500 });
        }
      }
      
      try {
        if (request.url.includes('favicon.ico')) {
          // 对于favicon请求直接返回204，避免数据库初始化
          return new Response(null, { status: 204 });
        }
        
        await initDatabase(config);
      } catch (error) {
        console.error(`数据库初始化失败: ${error.message}`);
        return new Response(`数据库初始化失败: ${error.message}`, { 
          status: 500,
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
        });
      }
      
      // 仅当配置了Telegram机器人令牌时才设置webhook
      if (config.tgBotToken) {
        try {
          const webhookUrl = `https://${config.domain}/webhook`;
          const webhookSet = await setWebhook(webhookUrl, config.tgBotToken);
          if (!webhookSet) {
            console.error('Webhook设置失败');
          }
        } catch (error) {
          console.error(`设置webhook时出错: ${error.message}`);
          // 继续处理请求，不中断操作
        }
      }
      
      const { pathname } = new URL(request.url);
      if (pathname === '/config') {
        const safeConfig = { maxSizeMB: config.maxSizeMB };
        return new Response(JSON.stringify(safeConfig), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (pathname === '/webhook' && request.method === 'POST') {
        return handleTelegramWebhook(request, config);
      }
      if (pathname === '/create-category' && request.method === 'POST') {
        return handleCreateCategoryRequest(request, config);
      }
      if (pathname === '/delete-category' && request.method === 'POST') {
        return handleDeleteCategoryRequest(request, config);
      }
      if (pathname === '/update-suffix' && request.method === 'POST') {
        return handleUpdateSuffixRequest(request, config);
      }
      const routes = {
        '/': () => handleAuthRequest(request, config),
        '/login': () => handleLoginRequest(request, config),
        '/upload': () => handleUploadRequest(request, config),
        '/admin': () => handleAdminRequest(request, config),
        '/delete': () => handleDeleteRequest(request, config),
        '/delete-multiple': () => handleDeleteMultipleRequest(request, config),
        '/search': () => handleSearchRequest(request, config),
        '/bing': handleBingImagesRequest
      };
      const handler = routes[pathname];
      if (handler) {
        return await handler();
      }
      return await handleFileRequest(request, config);
    }
  };
  async function handleTelegramWebhook(request, config) {
    try {
      const update = await request.json();
      if (update.message) {
        const chatId = update.message.chat.id.toString();
        let userSetting = await config.database.prepare('SELECT * FROM user_settings WHERE chat_id = ?').bind(chatId).first();
        if (!userSetting) {
          await config.database.prepare('INSERT INTO user_settings (chat_id, storage_type) VALUES (?, ?)').bind(chatId, 'r2').run();
          userSetting = { chat_id: chatId, storage_type: 'r2' };
        }
        if (userSetting.waiting_for === 'new_category' && update.message.text) {
          const categoryName = update.message.text.trim();
          try {
            const existingCategory = await config.database.prepare('SELECT id FROM categories WHERE name = ?').bind(categoryName).first();
            if (existingCategory) {
              await sendMessage(chatId, `⚠️ 分类"${categoryName}"已存在`, config.tgBotToken);
            } else {
              const time = Date.now();
              await config.database.prepare('INSERT INTO categories (name, created_at) VALUES (?, ?)').bind(categoryName, time).run();
              const newCategory = await config.database.prepare('SELECT id FROM categories WHERE name = ?').bind(categoryName).first();
              await config.database.prepare('UPDATE user_settings SET category_id = ?, waiting_for = NULL WHERE chat_id = ?').bind(newCategory.id, chatId).run();
              await sendMessage(chatId, `✅ 分类"${categoryName}"创建成功并已设为当前分类`, config.tgBotToken);
            }
    } catch (error) {
            console.error('创建分类失败:', error);
            await sendMessage(chatId, `❌ 创建分类失败: ${error.message}`, config.tgBotToken);
          }
          await config.database.prepare('UPDATE user_settings SET waiting_for = NULL WHERE chat_id = ?').bind(chatId).run();
          userSetting.waiting_for = null;
          await sendPanel(chatId, userSetting, config);
          return new Response('OK');
        }
        else if (userSetting.waiting_for === 'new_suffix' && update.message.text && userSetting.editing_file_id) {
          const newSuffix = update.message.text.trim();
          const fileId = userSetting.editing_file_id;
          try {
            const file = await config.database.prepare('SELECT * FROM files WHERE id = ?').bind(fileId).first();
            if (!file) {
              await sendMessage(chatId, "⚠️ 文件不存在或已被删除", config.tgBotToken);
            } else {
              const originalFileName = getFileName(file.url);
              const fileExt = originalFileName.split('.').pop();
              const newFileName = `${newSuffix}.${fileExt}`;
              const fileUrl = `https://${config.domain}/${newFileName}`;
              let success = false;
              if (file.storage_type === 'telegram') {
                await config.database.prepare('UPDATE files SET url = ? WHERE id = ?')
                  .bind(fileUrl, file.id).run();
                success = true;
              } 
              else if (file.storage_type === 'r2' && config.bucket) {
                try {
                  const fileId = file.fileId || originalFileName;
                  const r2File = await config.bucket.get(fileId);
                  if (r2File) {
                    const fileData = await r2File.arrayBuffer();
                    await storeFile(fileData, newFileName, r2File.httpMetadata.contentType, config);
                    await deleteFile(fileId, config);
                    await config.database.prepare('UPDATE files SET fileId = ?, url = ? WHERE id = ?')
                      .bind(newFileName, fileUrl, file.id).run();
                    success = true;
                  } else {
                    await config.database.prepare('UPDATE files SET url = ? WHERE id = ?')
                      .bind(fileUrl, file.id).run();
                    success = true;
                  }
                } catch (error) {
                  console.error('处理R2文件重命名失败:', error);
                  await config.database.prepare('UPDATE files SET url = ? WHERE id = ?')
                    .bind(fileUrl, file.id).run();
                  success = true;
                }
              } 
              else {
                await config.database.prepare('UPDATE files SET url = ? WHERE id = ?')
                  .bind(fileUrl, file.id).run();
                success = true;
              }
              if (success) {
                await sendMessage(chatId, `✅ 后缀修改成功！\n\n新链接：${fileUrl}`, config.tgBotToken);
              } else {
                await sendMessage(chatId, "❌ 后缀修改失败，请稍后重试", config.tgBotToken);
              }
            }
          } catch (error) {
            console.error('修改后缀失败:', error);
            await sendMessage(chatId, `❌ 修改后缀失败: ${error.message}`, config.tgBotToken);
          }
          await config.database.prepare('UPDATE user_settings SET waiting_for = NULL, editing_file_id = NULL WHERE chat_id = ?').bind(chatId).run();
          userSetting.waiting_for = null;
          userSetting.editing_file_id = null;
          await sendPanel(chatId, userSetting, config);
          return new Response('OK');
        }
        if (update.message.text === '/start') {
          await sendPanel(chatId, userSetting, config);
        }
        else if (update.message.photo || update.message.document || update.message.video || update.message.audio || update.message.voice || update.message.video_note) {
          console.log('收到文件上传:', JSON.stringify({
            hasPhoto: !!update.message.photo,
            hasDocument: !!update.message.document,
            hasVideo: !!update.message.video,
            hasAudio: !!update.message.audio,
            hasVoice: !!update.message.voice,
            hasVideoNote: !!update.message.video_note
          }));
          let file;
          let isDocument = false;
          if (update.message.document) {
            file = update.message.document;
            isDocument = true;
          } else if (update.message.video) {
            file = update.message.video;
            isDocument = true;
          } else if (update.message.audio) {
            file = update.message.audio;
            isDocument = true;
          } else if (update.message.voice) {
            file = update.message.voice;
            isDocument = true;
          } else if (update.message.video_note) {
            file = update.message.video_note;
            isDocument = true;
          } else if (update.message.photo) {
            file = update.message.photo?.slice(-1)[0]; 
            isDocument = false;
          }
          if (file) {
            await handleMediaUpload(chatId, file, isDocument, config, userSetting);
          } else {
            await sendMessage(chatId, "❌ 无法识别的文件类型", config.tgBotToken);
          }
        }
        else {
          const message = update.message;
          let fileField = null;
          for (const field in message) {
            if (message[field] && typeof message[field] === 'object' && message[field].file_id) {
              fileField = field;
              break;
            }
          }
          if (fileField) {
            console.log(`找到未明确处理的文件类型: ${fileField}`, JSON.stringify(message[fileField]));
            await handleMediaUpload(chatId, message[fileField], true, config, userSetting);
          } else if (message.text && message.text !== '/start') {
            await sendMessage(chatId, "请发送图片或文件进行上传，或使用 /start 查看主菜单", config.tgBotToken);
          }
        }
      }
      else if (update.callback_query) {
        const chatId = update.callback_query.from.id.toString();
        let userSetting = await config.database.prepare('SELECT * FROM user_settings WHERE chat_id = ?').bind(chatId).first();
        if (!userSetting) {
          await config.database.prepare('INSERT INTO user_settings (chat_id, storage_type) VALUES (?, ?)').bind(chatId, 'r2').run();
          userSetting = { chat_id: chatId, storage_type: 'r2' };
        }
        await handleCallbackQuery(update, config, userSetting);
      }
      return new Response('OK');
    } catch (error) {
      console.error('Error handling webhook:', error);
      return new Response('Error processing webhook', { status: 500 });
    }
  }
  async function sendPanel(chatId, userSetting, config) {
    let categoryName = '默认';
    let categoryId = userSetting && userSetting.category_id;
    if (categoryId) {
      const category = await config.database.prepare('SELECT name FROM categories WHERE id = ?').bind(categoryId).first();
      if (category) {
        categoryName = category.name;
      } else {
        categoryId = null;
      }
    }
    if (!categoryId) {
      let defaultCategory = await config.database.prepare('SELECT id, name FROM categories WHERE name = ?').bind('默认分类').first();
      if (!defaultCategory) {
        try {
          console.log('默认分类不存在，正在创建...');
          const result = await config.database.prepare('INSERT INTO categories (name, created_at) VALUES (?, ?)')
            .bind('默认分类', Date.now()).run();
          const newDefaultId = result.meta && result.meta.last_row_id;
          if (newDefaultId) {
            defaultCategory = { id: newDefaultId, name: '默认分类' };
            console.log(`已创建新的默认分类，ID: ${newDefaultId}`);
            if (userSetting) {
              await config.database.prepare('UPDATE user_settings SET category_id = ? WHERE chat_id = ?')
                .bind(newDefaultId, chatId).run();
              userSetting.category_id = newDefaultId;
              categoryId = newDefaultId;
            }
          }
        } catch (error) {
          console.error('创建默认分类失败:', error);
        }
      } else {
        categoryId = defaultCategory.id;
        categoryName = defaultCategory.name;
        if (userSetting) {
          await config.database.prepare('UPDATE user_settings SET category_id = ? WHERE chat_id = ?')
            .bind(categoryId, chatId).run();
          userSetting.category_id = categoryId;
        }
      }
    }
    let notificationText = await fetchNotification();
    const defaultNotification = 
      "➡️ 现在您可以直接发送图片或文件，上传完成后会自动生成图床直链\n" +
      "➡️ 所有上传的文件都可以在网页后台管理，支持删除、查看、分类等操作";
    const message = 
      "📲 图床助手 3.0\n\n" +
      "📡 系统状态 ─────────────\n" +
      `🔹 存储类型: ${userSetting.storage_type === 'r2' ? 'R2对象存储' : 'Telegram存储'}\n` +
      `🔹 当前分类: ${categoryName}\n` +
      `🔹 文件大小: 最大${config.maxSizeMB}MB\n\n` +
      `${notificationText || defaultNotification}`;
    const keyboard = {
      inline_keyboard: [
        [
          { text: "🔄 切换存储方式", callback_data: "switch_storage" },
          { text: "📊 统计信息", callback_data: "stats" }
        ],
        [
          { text: "📂 选择分类", callback_data: "list_categories" },
          { text: "➕ 新建分类", callback_data: "create_category" }
        ],
        [
          { text: "📝 修改后缀", callback_data: "edit_suffix" },
          { text: "📋 最近文件", callback_data: "recent_files" }
        ],
        [
          { text: "🔗 GitHub项目", url: "https://github.com/iawooo/ctt" }
        ]
      ]
    };
    await fetch(`https://api.telegram.org/bot${config.tgBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        reply_markup: keyboard,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
  }
  async function handleCallbackQuery(update, config, userSetting) {
    const cbData = update.callback_query.data;
    const chatId = update.callback_query.from.id.toString();
    const answerPromise = fetch(`https://api.telegram.org/bot${config.tgBotToken}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: update.callback_query.id
      })
    }).catch(error => {
      console.error('确认回调查询失败:', error);
    });
    try {
      if (cbData === 'switch_storage') {
        const newStorageType = userSetting.storage_type === 'r2' ? 'telegram' : 'r2';
        await config.database.prepare('UPDATE user_settings SET storage_type = ? WHERE chat_id = ?').bind(newStorageType, chatId).run();
        await sendMessage(chatId, `✅ 已切换到 ${newStorageType === 'r2' ? 'R2对象存储' : 'Telegram存储'}`, config.tgBotToken);
        await sendPanel(chatId, { ...userSetting, storage_type: newStorageType }, config);
      } else if (cbData === 'list_categories') {
        const categoriesPromise = config.database.prepare('SELECT id, name FROM categories').all();
        await answerPromise;
        const categories = await categoriesPromise;
        if (!categories.results || categories.results.length === 0) {
          await sendMessage(chatId, "⚠️ 暂无分类，请先创建分类", config.tgBotToken);
          return;
        }
        const categoriesText = categories.results.map((cat, i) => `${i + 1}. ${cat.name} (ID: ${cat.id})`).join('\n');
        const keyboard = {
          inline_keyboard: categories.results.map(cat => [
            { text: cat.name, callback_data: `set_category_${cat.id}` }
          ]).concat([[{ text: "« 返回", callback_data: "back_to_panel" }]])
        };
        await fetch(`https://api.telegram.org/bot${config.tgBotToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: "📂 请选择要使用的分类：\n\n" + categoriesText,
            reply_markup: keyboard
          })
        });
      } else if (cbData === 'create_category') {
        await Promise.all([
          sendMessage(chatId, "📝 请回复此消息，输入新分类名称", config.tgBotToken),
          config.database.prepare('UPDATE user_settings SET waiting_for = ? WHERE chat_id = ?').bind('new_category', chatId).run()
        ]);
      } else if (cbData.startsWith('set_category_')) {
        const categoryId = parseInt(cbData.split('_')[2]);
        const [_, category] = await Promise.all([
          config.database.prepare('UPDATE user_settings SET category_id = ? WHERE chat_id = ?').bind(categoryId, chatId).run(),
          config.database.prepare('SELECT name FROM categories WHERE id = ?').bind(categoryId).first()
        ]);
        await sendMessage(chatId, `✅ 已切换到分类: ${category?.name || '未知分类'}`, config.tgBotToken);
        await sendPanel(chatId, { ...userSetting, category_id: categoryId }, config);
      } else if (cbData === 'back_to_panel') {
        await answerPromise;
        await sendPanel(chatId, userSetting, config);
      } else if (cbData === 'stats') {
        await answerPromise;
        const stats = await config.database.prepare(`
          SELECT COUNT(*) as total_files,
                 SUM(file_size) as total_size,
                 COUNT(DISTINCT category_id) as total_categories
          FROM files WHERE chat_id = ?
        `).bind(chatId).first();
        const statsMessage = `📊 您的使用统计
    ─────────────
    📁 总文件数: ${stats.total_files || 0}
    📊 总存储量: ${formatSize(stats.total_size || 0)}
    📋 使用分类: ${stats.total_categories || 0}个`;
        await sendMessage(chatId, statsMessage, config.tgBotToken);
      } else if (cbData === 'edit_suffix') {
        await answerPromise;
        const recentFiles = await config.database.prepare(`
          SELECT id, url, fileId, file_name, created_at, storage_type 
          FROM files 
          WHERE chat_id = ?
          ORDER BY created_at DESC 
          LIMIT 5
        `).bind(chatId).all();
        if (!recentFiles.results || recentFiles.results.length === 0) {
          await sendMessage(chatId, "⚠️ 您还没有上传过文件", config.tgBotToken);
          return;
        }
        const keyboard = {
          inline_keyboard: recentFiles.results.map(file => {
            const fileName = file.file_name || getFileName(file.url);
            return [{ text: fileName, callback_data: `edit_suffix_file_${file.id}` }];
          }).concat([[{ text: "« 返回", callback_data: "back_to_panel" }]])
        };
        await fetch(`https://api.telegram.org/bot${config.tgBotToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: "📝 请选择要修改后缀的文件：",
            reply_markup: keyboard
          })
        });
      } else if (cbData.startsWith('edit_suffix_file_')) {
        const fileId = cbData.split('_')[3];
        await answerPromise;
        const file = await config.database.prepare('SELECT * FROM files WHERE id = ?').bind(fileId).first();
        if (!file) {
          await sendMessage(chatId, "⚠️ 文件不存在或已被删除", config.tgBotToken);
          return;
        }
        const fileName = getFileName(file.url);
        const fileNameParts = fileName.split('.');
        const extension = fileNameParts.pop(); 
        const currentSuffix = fileNameParts.join('.'); 
        await Promise.all([
          config.database.prepare('UPDATE user_settings SET waiting_for = ?, editing_file_id = ? WHERE chat_id = ?')
            .bind('new_suffix', fileId, chatId).run(),
          sendMessage(chatId, `📝 请回复此消息，输入文件的新后缀\n\n当前文件: ${fileName}\n当前后缀: ${currentSuffix}`, config.tgBotToken)
        ]);
      } else if (cbData === 'recent_files') {
        await answerPromise;
        const recentFiles = await config.database.prepare(`
          SELECT id, url, created_at, file_name, storage_type 
          FROM files 
          WHERE chat_id = ?
          ORDER BY created_at DESC 
          LIMIT 10
        `).bind(chatId).all();
        if (!recentFiles.results || recentFiles.results.length === 0) {
          await sendMessage(chatId, "⚠️ 您还没有上传过文件", config.tgBotToken);
          return;
        }
        const filesList = recentFiles.results.map((file, i) => {
          const fileName = file.file_name || getFileName(file.url);
          const date = new Date(file.created_at * 1000).toLocaleString();
          return `${i + 1}. ${fileName}\n   📅 ${date}\n   🔗 ${file.url}`;
        }).join('\n\n');
        const keyboard = {
          inline_keyboard: [
            [{ text: "« 返回", callback_data: "back_to_panel" }]
          ]
        };
        await fetch(`https://api.telegram.org/bot${config.tgBotToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: "📋 您最近上传的文件：\n\n" + filesList,
            reply_markup: keyboard,
            disable_web_page_preview: true
          })
        });
      }
    } catch (error) {
      console.error('处理回调查询时出错:', error);
      await answerPromise;
      sendMessage(chatId, `❌ 处理请求时出错: ${error.message}`, config.tgBotToken);
    }
  }
  async function handleMediaUpload(chatId, file, isDocument, config, userSetting) {
    const processingMessage = await sendMessage(chatId, "⏳ 正在处理您的文件，请稍候...", config.tgBotToken);
    const processingMessageId = processingMessage?.result?.message_id;
    try {
      console.log('原始文件信息:', JSON.stringify(file));
      const response = await fetch(`https://api.telegram.org/bot${config.tgBotToken}/getFile?file_id=${file.file_id}`);
      const data = await response.json();
      if (!data.ok) throw new Error(`获取文件路径失败: ${JSON.stringify(data)}`);
      console.log('获取到文件路径:', data.result.file_path);
      const telegramUrl = `https://api.telegram.org/file/bot${config.tgBotToken}/${data.result.file_path}`;
      const fileResponse = await fetch(telegramUrl);
      if (!fileResponse.ok) throw new Error(`获取文件内容失败: ${fileResponse.status} ${fileResponse.statusText}`);
      const contentLength = fileResponse.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > config.maxSizeMB * 1024 * 1024) {
        if (processingMessageId) {
          await fetch(`https://api.telegram.org/bot${config.tgBotToken}/deleteMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              message_id: processingMessageId
            })
          }).catch(err => console.error('删除处理消息失败:', err));
        }
        await sendMessage(chatId, `❌ 文件超过${config.maxSizeMB}MB限制`, config.tgBotToken);
        return;
      }
      let fileName = '';
      let ext = '';
      let mimeType = file.mime_type || 'application/octet-stream';
      const filePathExt = data.result.file_path.split('.').pop().toLowerCase();
      if (file.file_name) {
        fileName = file.file_name;
        ext = (fileName.split('.').pop() || '').toLowerCase();
      } 
      else if (filePathExt && filePathExt !== data.result.file_path.toLowerCase()) {
        ext = filePathExt;
      } 
      else {
        ext = getExtensionFromMime(mimeType);
      }
      if (!fileName) {
        if (file.video_note) {
          fileName = `video_note_${Date.now()}.${ext}`;
        } else if (file.voice) {
          fileName = `voice_message_${Date.now()}.${ext}`;
        } else if (file.audio) {
          fileName = (file.audio.title || `audio_${Date.now()}`) + `.${ext}`;
        } else if (file.video) {
          fileName = `video_${Date.now()}.${ext}`;
        } else {
          fileName = `file_${Date.now()}.${ext}`;
        }
      }
      if (!mimeType || mimeType === 'application/octet-stream') {
        mimeType = getContentType(ext);
      }
      const mimeParts = mimeType.split('/');
      const mainType = mimeParts[0] || '';
      const subType = mimeParts[1] || '';
      console.log('处理文件:', JSON.stringify({ 
        fileName, 
        ext, 
        mimeType, 
        mainType, 
        subType, 
        size: contentLength,
        filePath: data.result.file_path
      }));
      await fetch(`https://api.telegram.org/bot${config.tgBotToken}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: processingMessageId,
          text: "⏳ 文件已接收，正在上传到存储..."
        })
      }).catch(err => console.error('更新处理消息失败:', err));
      const storageType = userSetting && userSetting.storage_type ? userSetting.storage_type : 'r2';
      let categoryId = null;
      if (userSetting && userSetting.category_id) {
        categoryId = userSetting.category_id;
      } else {
        let defaultCategory = await config.database.prepare('SELECT id FROM categories WHERE name = ?').bind('默认分类').first();
        if (!defaultCategory) {
          try {
            console.log('默认分类不存在，正在创建...');
            const result = await config.database.prepare('INSERT INTO categories (name, created_at) VALUES (?, ?)')
              .bind('默认分类', Date.now()).run();
            const newDefaultId = result.meta && result.meta.last_row_id;
            if (newDefaultId) {
              defaultCategory = { id: newDefaultId };
              console.log(`已创建新的默认分类，ID: ${newDefaultId}`);
            }
          } catch (error) {
            console.error('创建默认分类失败:', error);
          }
        }
        if (defaultCategory) {
          categoryId = defaultCategory.id;
        }
      }
      let finalUrl, dbFileId, dbMessageId;
      const timestamp = Date.now();
      const originalFileName = fileName.replace(/[^a-zA-Z0-9\-\_\.]/g, '_'); 
      const key = `${timestamp}_${originalFileName}`;
      if (storageType === 'r2' && config.bucket) {
        const arrayBuffer = await fileResponse.arrayBuffer();
        await config.bucket.put(key, arrayBuffer, { 
          httpMetadata: { contentType: mimeType } 
        });
        finalUrl = `https://${config.domain}/${key}`;
        dbFileId = key;
        dbMessageId = 0;
      } else {
        let method, field;
        let messageId = null;
        let fileId = null;
        if (mainType === 'image' && !['svg+xml', 'x-icon'].includes(subType)) {
          method = 'sendPhoto';
          field = 'photo';
        } else if (mainType === 'video') {
          method = 'sendVideo';
          field = 'video';
        } else if (mainType === 'audio') {
          method = 'sendAudio';
          field = 'audio';
        } else {
          method = 'sendDocument';
          field = 'document';
        }
        console.log('Telegram上传方法:', { method, field });
        const arrayBuffer = await fileResponse.arrayBuffer();
        const tgFormData = new FormData();
        tgFormData.append('chat_id', config.tgStorageChatId);
        const blob = new Blob([arrayBuffer], { type: mimeType });
        tgFormData.append(field, blob, fileName);
        if (field !== 'photo') {
          tgFormData.append('caption', `File: ${fileName}\nType: ${mimeType}\nSize: ${formatSize(parseInt(contentLength || '0'))}`);
        }
        const tgResponse = await fetch(
          `https://api.telegram.org/bot${config.tgBotToken}/${method}`,
          { method: 'POST', body: tgFormData }
        );
        if (!tgResponse.ok) {
          const errorText = await tgResponse.text();
          console.error('Telegram API错误:', errorText);
          if (method !== 'sendDocument') {
            console.log('尝试使用sendDocument方法重新上传');
            const retryFormData = new FormData();
            retryFormData.append('chat_id', config.tgStorageChatId);
            retryFormData.append('document', blob, fileName);
            retryFormData.append('caption', `File: ${fileName}\nType: ${mimeType}\nSize: ${formatSize(parseInt(contentLength || '0'))}`);
            const retryResponse = await fetch(
              `https://api.telegram.org/bot${config.tgBotToken}/sendDocument`,
              { method: 'POST', body: retryFormData }
            );
            if (!retryResponse.ok) {
              console.error('Telegram文档上传也失败:', await retryResponse.text());
              throw new Error('Telegram文件上传失败');
            }
            const retryData = await retryResponse.json();
            const retryResult = retryData.result;
            messageId = retryResult.message_id;
            fileId = retryResult.document?.file_id;
            if (!fileId || !messageId) {
              throw new Error('重试上传后仍未获取到有效的文件ID');
            }
          } else {
            throw new Error('Telegram参数配置错误: ' + errorText);
          }
        } else {
          const tgData = await tgResponse.json();
          const result = tgData.result;
          messageId = result.message_id;
          if (field === 'photo') {
            const photos = result.photo;
            fileId = photos[photos.length - 1]?.file_id; 
          } else if (field === 'video') {
            fileId = result.video?.file_id;
          } else if (field === 'audio') {
            fileId = result.audio?.file_id;
          } else {
            fileId = result.document?.file_id;
          }
        }
        if (!fileId) throw new Error('未获取到文件ID');
        if (!messageId) throw new Error('未获取到tg消息ID');
        finalUrl = `https://${config.domain}/${key}`;
        dbFileId = fileId;
        dbMessageId = messageId;
      }
      await fetch(`https://api.telegram.org/bot${config.tgBotToken}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: processingMessageId,
          text: "⏳ 正在写入数据库..."
        })
      }).catch(err => console.error('更新处理消息失败:', err));
      const time = Date.now(); 
      await config.database.prepare(`
        INSERT INTO files (
          url, 
          fileId, 
          message_id, 
          created_at, 
          file_name, 
          file_size, 
          mime_type, 
          chat_id, 
          category_id, 
          storage_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        finalUrl,
        dbFileId,
        dbMessageId,
        time, 
        fileName, 
        contentLength,
        mimeType,
        chatId,
        categoryId,
        storageType
      ).run();
      if (processingMessageId) {
        await fetch(`https://api.telegram.org/bot${config.tgBotToken}/deleteMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: processingMessageId
          })
        }).catch(err => console.error('删除处理消息失败:', err));
      }
      const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(finalUrl)}`;
      await fetch(`https://api.telegram.org/bot${config.tgBotToken}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          photo: qrCodeUrl,
          caption: `✅ 文件上传成功\n\n📝 图床直链：\n${finalUrl}\n\n🔍 扫描上方二维码快速访问`,
          parse_mode: 'HTML'
        })
      });
    } catch (error) {
      console.error("Error handling media upload:", error);
      if (processingMessageId) {
        await fetch(`https://api.telegram.org/bot${config.tgBotToken}/deleteMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: processingMessageId
          })
        }).catch(err => console.error('删除处理消息失败:', err));
      }
      await sendMessage(chatId, `❌ 上传失败: ${error.message}`, config.tgBotToken);
    }
  }
  async function getTelegramFileUrl(fileId, botToken, config) {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
    const data = await response.json();
    if (!data.ok) throw new Error('获取文件路径失败');
    const filePath = data.result.file_path;
    const fileName = filePath.split('/').pop();
    const timestamp = Date.now();
    const fileExt = fileName.split('.').pop();
    const newFileName = `${timestamp}.${fileExt}`;
    if (config && config.domain) {
      return `https://${config.domain}/${newFileName}`;
    } else {
      return `https://api.telegram.org/file/bot${botToken}/${filePath}`;
    }
  }
  function authenticate(request, config) {
    const cookies = request.headers.get("Cookie") || "";
    const authToken = cookies.match(/auth_token=([^;]+)/);
    if (authToken) {
      try {
        const tokenData = JSON.parse(atob(authToken[1]));
        const now = Date.now();
        if (now > tokenData.expiration) {
          console.log("Token已过期");
          return false;
        }
        return tokenData.username === config.username;
    } catch (error) {
        console.error("Token的用户名不匹配", error);
      return false;
    }
    }
    return false;
  }
  async function handleAuthRequest(request, config) {
    if (config.enableAuth) {
      const isAuthenticated = authenticate(request, config);
      if (!isAuthenticated) {
        return handleLoginRequest(request, config);
      }
      return handleUploadRequest(request, config);
    }
    return handleUploadRequest(request, config);
  }
  async function handleLoginRequest(request, config) {
    if (request.method === 'POST') {
      const { username, password } = await request.json();
      if (username === config.username && password === config.password) {
        const expirationDate = new Date();
        // 使用配置的cookie值（天数）
        const cookieDays = config.cookie || 7; // 默认7天
        expirationDate.setDate(expirationDate.getDate() + cookieDays);
        const expirationTimestamp = expirationDate.getTime();
        const tokenData = JSON.stringify({
          username: config.username,
          expiration: expirationTimestamp
        });
        const token = btoa(tokenData);
        const cookie = `auth_token=${token}; Path=/; HttpOnly; Secure; Expires=${expirationDate.toUTCString()}`;
        return new Response("登录成功", {
          status: 200,
          headers: {
            "Set-Cookie": cookie,
            "Content-Type": "text/plain"
          }
        });
      }
      return new Response("认证失败", { status: 401 });
    }
    const html = generateLoginPage();
    return new Response(html, {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    });
  }
  async function handleCreateCategoryRequest(request, config) {
    if (config.enableAuth && !authenticate(request, config)) {
      return new Response(JSON.stringify({ status: 0, msg: "未授权" }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    try {
      const { name } = await request.json();
      if (!name || typeof name !== 'string' || name.trim() === '') {
        return new Response(JSON.stringify({ status: 0, msg: "分类名称不能为空" }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      const categoryName = name.trim();
      const time = Date.now();
      const existingCategory = await config.database.prepare('SELECT id FROM categories WHERE name = ?').bind(categoryName).first();
      if (existingCategory) {
        return new Response(JSON.stringify({ status: 0, msg: `分类 "${categoryName}" 已存在，请选择一个不同的名称！` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      await config.database.prepare('INSERT INTO categories (name, created_at) VALUES (?, ?)')
        .bind(categoryName, time).run();
      const category = await config.database.prepare('SELECT id FROM categories WHERE name = ?').bind(categoryName).first();
      return new Response(JSON.stringify({ status: 1, msg: "分类创建成功", category: { id: category.id, name: categoryName } }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ status: 0, msg: `创建分类失败：${error.message}` }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
  async function handleDeleteCategoryRequest(request, config) {
    if (config.enableAuth && !authenticate(request, config)) {
      return new Response(JSON.stringify({ status: 0, msg: "未授权" }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    try {
      const { id } = await request.json();
      if (!id || isNaN(id)) {
        return new Response(JSON.stringify({ status: 0, msg: "分类ID无效" }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      const isDefaultCategory = await config.database.prepare('SELECT id FROM categories WHERE id = ? AND name = ?')
        .bind(id, '默认分类').first();
      if (isDefaultCategory) {
        return new Response(JSON.stringify({ status: 0, msg: "默认分类不能删除" }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      const category = await config.database.prepare('SELECT name FROM categories WHERE id = ?').bind(id).first();
      if (!category) {
        return new Response(JSON.stringify({ status: 0, msg: "分类不存在" }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      const defaultCategory = await config.database.prepare('SELECT id FROM categories WHERE name = ?')
        .bind('默认分类').first();
      let defaultCategoryId;
      if (!defaultCategory) {
        const result = await config.database.prepare('INSERT INTO categories (name, created_at) VALUES (?, ?)')
          .bind('默认分类', Date.now()).run();
        defaultCategoryId = result.meta && result.meta.last_row_id ? result.meta.last_row_id : null;
        console.log('创建了新的默认分类，ID:', defaultCategoryId);
      } else {
        defaultCategoryId = defaultCategory.id;
      }
      if (defaultCategoryId) {
        await config.database.prepare('UPDATE files SET category_id = ? WHERE category_id = ?')
          .bind(defaultCategoryId, id).run();
        await config.database.prepare('UPDATE user_settings SET current_category_id = ? WHERE current_category_id = ?')
          .bind(defaultCategoryId, id).run();
      } else {
        await config.database.prepare('UPDATE files SET category_id = NULL WHERE category_id = ?').bind(id).run();
        await config.database.prepare('UPDATE user_settings SET current_category_id = NULL WHERE current_category_id = ?').bind(id).run();
      }
      await config.database.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
      return new Response(JSON.stringify({ 
        status: 1, 
        msg: `分类 "${category.name}" 删除成功${defaultCategoryId ? '，相关文件已移至默认分类' : ''}` 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('删除分类失败:', error);
      return new Response(JSON.stringify({ status: 0, msg: `删除分类失败：${error.message}` }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
  async function handleUploadRequest(request, config) {
    if (config.enableAuth && !authenticate(request, config)) {
      return Response.redirect(`${new URL(request.url).origin}/`, 302);
    }
    if (request.method === 'GET') {
      const categories = await config.database.prepare('SELECT id, name FROM categories').all();
      const categoryOptions = categories.results.length
        ? categories.results.map(c => `<option value="${c.id}">${c.name}</option>`).join('')
        : '<option value="">暂无分类</option>';
      const chatId = config.tgChatId[0];
      let userSetting = await config.database.prepare('SELECT * FROM user_settings WHERE chat_id = ?').bind(chatId).first();
      if (!userSetting) {
        const defaultCategory = await config.database.prepare('SELECT id FROM categories WHERE name = ?').bind('默认分类').first();
        await config.database.prepare('INSERT INTO user_settings (chat_id, storage_type, current_category_id) VALUES (?, ?, ?)')
          .bind(chatId, 'telegram', defaultCategory.id).run();
        userSetting = { storage_type: 'telegram', current_category_id: defaultCategory.id };
      }
      const html = generateUploadPage(categoryOptions, userSetting.storage_type);
      return new Response(html, {
        headers: { 'Content-Type': 'text/html;charset=UTF-8' }
      });
    }
    try {
      const formData = await request.formData();
      const file = formData.get('file');
      const categoryId = formData.get('category');
      const storageType = formData.get('storage_type');
      if (!file) throw new Error('未找到文件');
      if (file.size > config.maxSizeMB * 1024 * 1024) throw new Error(`文件超过${config.maxSizeMB}MB限制`);
      const chatId = config.tgChatId[0];
      let defaultCategory = await config.database.prepare('SELECT id FROM categories WHERE name = ?').bind('默认分类').first();
      if (!defaultCategory) {
        try {
          console.log('默认分类不存在，正在创建...');
          const result = await config.database.prepare('INSERT INTO categories (name, created_at) VALUES (?, ?)')
            .bind('默认分类', Date.now()).run();
          const newDefaultId = result.meta && result.meta.last_row_id;
          if (newDefaultId) {
            defaultCategory = { id: newDefaultId };
            console.log(`已创建新的默认分类，ID: ${newDefaultId}`);
          }
        } catch (error) {
          console.error('创建默认分类失败:', error);
          defaultCategory = { id: categoryId || null };
        }
      }
      const finalCategoryId = categoryId || (defaultCategory ? defaultCategory.id : null);
      await config.database.prepare('UPDATE user_settings SET storage_type = ?, current_category_id = ? WHERE chat_id = ?')
        .bind(storageType, finalCategoryId, chatId).run();
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      const mimeType = getContentType(ext);
      const [mainType] = mimeType.split('/');
      const typeMap = {
        image: { method: 'sendPhoto', field: 'photo' },
        video: { method: 'sendVideo', field: 'video' },
        audio: { method: 'sendAudio', field: 'audio' }
      };
      let { method = 'sendDocument', field = 'document' } = typeMap[mainType] || {};
      if (['application', 'text'].includes(mainType)) {
        method = 'sendDocument';
        field = 'document';
      }
      let finalUrl, dbFileId, dbMessageId;
      if (storageType === 'r2') {
        const key = `${Date.now()}.${ext}`;
        await config.bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: mimeType } });
        finalUrl = `https://${config.domain}/${key}`;
        dbFileId = key;
        dbMessageId = -1;
      } else {
        const tgFormData = new FormData();
        tgFormData.append('chat_id', config.tgStorageChatId);
        tgFormData.append(field, file, file.name);
        const tgResponse = await fetch(
          `https://api.telegram.org/bot${config.tgBotToken}/${method}`,
          { method: 'POST', body: tgFormData }
        );
        if (!tgResponse.ok) throw new Error('Telegram参数配置错误');
        const tgData = await tgResponse.json();
        const result = tgData.result;
        const messageId = result.message_id;
        const fileId = result.document?.file_id ||
                       result.video?.file_id ||
                       result.audio?.file_id ||
                       (result.photo && result.photo[result.photo.length - 1]?.file_id);
        if (!fileId) throw new Error('未获取到文件ID');
        if (!messageId) throw new Error('未获取到tg消息ID');
        finalUrl = `https://${config.domain}/${Date.now()}.${ext}`;
        dbFileId = fileId;
        dbMessageId = messageId;
      }
      const time = Date.now();
      const timestamp = new Date(time + 8 * 60 * 60 * 1000).toISOString();
      const url = `https://${config.domain}/${time}.${ext}`;
      await config.database.prepare(`
        INSERT INTO files (url, fileId, message_id, created_at, file_name, file_size, mime_type, storage_type, category_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        url,
        dbFileId,
        dbMessageId,
        timestamp,
        file.name,
        file.size,
        file.type || getContentType(ext),
        storageType,
        finalCategoryId
      ).run();
      return new Response(
        JSON.stringify({ status: 1, msg: "✔ 上传成功", url }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      console.error(`[Upload Error] ${error.message}`);
      let statusCode = 500;
      if (error.message.includes(`文件超过${config.maxSizeMB}MB限制`)) {
        statusCode = 400;
      } else if (error.message.includes('Telegram参数配置错误')) {
        statusCode = 502;
      } else if (error.message.includes('未获取到文件ID') || error.message.includes('未获取到tg消息ID')) {
        statusCode = 500;
      } else if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
        statusCode = 504;
      }
      return new Response(
        JSON.stringify({ status: 0, msg: "✘ 上传失败", error: error.message }),
        { status: statusCode, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }
  async function handleDeleteMultipleRequest(request, config) {
    if (config.enableAuth && !authenticate(request, config)) {
      return Response.redirect(`${new URL(request.url).origin}/`, 302);
    }
    try {
      const { urls } = await request.json();
      if (!Array.isArray(urls) || urls.length === 0) {
        return new Response(JSON.stringify({ 
          status: 0, 
          error: '无效的URL列表' 
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      const results = {
        success: [],
        failed: []
      };
      for (const url of urls) {
        try {
          const fileName = url.split('/').pop();
          let file = await config.database.prepare(
            'SELECT id, fileId, message_id, storage_type FROM files WHERE url = ?'
          ).bind(url).first();
          if (!file && fileName) {
            file = await config.database.prepare(
              'SELECT id, fileId, message_id, storage_type FROM files WHERE fileId = ?'
            ).bind(fileName).first();
          }
          if (file) {
            console.log(`正在删除文件: ${url}, 存储类型: ${file.storage_type}`);
            if (file.storage_type === 'telegram' && file.message_id) {
              try {
                await fetch(
                  `https://api.telegram.org/bot${config.tgBotToken}/deleteMessage?chat_id=${config.tgStorageChatId}&message_id=${file.message_id}`
                );
                console.log(`已从Telegram删除消息: ${file.message_id}`);
              } catch (error) {
                console.error(`从Telegram删除消息失败: ${error.message}`);
              }
            } else if (file.storage_type === 'r2' && file.fileId && config.bucket) {
              try {
                await config.bucket.delete(file.fileId);
                console.log(`已从R2删除文件: ${file.fileId}`);
              } catch (error) {
                console.error(`从R2删除文件失败: ${error.message}`);
              }
            }
            await config.database.prepare('DELETE FROM files WHERE id = ?').bind(file.id).run();
            console.log(`已从数据库删除记录: ID=${file.id}`);
            results.success.push(url);
          } else {
            console.log(`未找到文件记录: ${url}`);
            results.failed.push({url, reason: '未找到文件记录'});
          }
        } catch (error) {
          console.error(`删除文件失败 ${url}: ${error.message}`);
          results.failed.push({url, reason: error.message});
        }
      }
      return new Response(
        JSON.stringify({ 
          status: 1, 
          message: '批量删除处理完成',
          results: {
            success: results.success.length,
            failed: results.failed.length,
            details: results
          }
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      console.error(`[Delete Multiple Error] ${error.message}`);
      return new Response(
        JSON.stringify({ 
          status: 0, 
          error: error.message 
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }
  async function handleAdminRequest(request, config) {
    if (config.enableAuth && !authenticate(request, config)) {
      return Response.redirect(`${new URL(request.url).origin}/`, 302);
    }
    try {
      const categories = await config.database.prepare('SELECT id, name FROM categories').all();
      const categoryOptions = categories.results.length
        ? categories.results.map(c => `<option value="${c.id}">${c.name}</option>`).join('')
        : '<option value="">暂无分类</option>';
      const files = await config.database.prepare(`
        SELECT f.url, f.fileId, f.message_id, f.created_at, f.file_name, f.file_size, f.mime_type, f.storage_type, c.name as category_name, c.id as category_id
        FROM files f
        LEFT JOIN categories c ON f.category_id = c.id
        ORDER BY f.created_at DESC
      `).all();
      const fileList = files.results || [];
      console.log(`文件总数: ${fileList.length}`);
      const fileCards = fileList.map(file => {
          const url = file.url;
          return `
            <div class="file-card" data-url="${url}" data-category-id="${file.category_id || ''}">
              <input type="checkbox" class="file-checkbox" value="${url}">
              <div class="file-preview">
                ${getPreviewHtml(url)}
              </div>
              <div class="file-info">
                <div>${getFileName(url)}</div>
                <div>大小: ${formatSize(file.file_size || 0)}</div>
                <div>上传时间: ${formatDate(file.created_at)}</div>
                <div>分类: ${file.category_name || '无分类'}</div>
              </div>
              <div class="file-actions" style="display:flex; gap:5px; justify-content:space-between; padding:10px;">
                <button class="btn btn-share" style="flex:1; background-color:#3498db; color:white; padding:8px 12px; border-radius:6px; border:none; cursor:pointer; font-weight:bold;" onclick="shareFile('${url}', '${getFileName(url)}')">分享</button>
                <button class="btn btn-delete" style="flex:1;" onclick="showConfirmModal('确定要删除这个文件吗？', () => deleteFile('${url}'))">删除</button>
                <button class="btn btn-edit" style="flex:1;" onclick="showEditSuffixModal('${url}')">修改后缀</button>
              </div>
            </div>
          `;
      }).join('');
      const html = generateAdminPage(fileCards, categoryOptions);
      return new Response(html, {
        headers: { 'Content-Type': 'text/html;charset=UTF-8' }
      });
    } catch (error) {
      console.error(`[Admin Error] ${error.message}`);
      return new Response(`加载文件列表失败，请检查数据库配置：${error.message}`, { status: 500 });
    }
  }
  async function handleSearchRequest(request, config) {
    if (config.enableAuth && !authenticate(request, config)) {
      return Response.redirect(`${new URL(request.url).origin}/`, 302);
    }
    try {
      const { query } = await request.json();
      const searchPattern = `%${query}%`;
      const files = await config.database.prepare(`
        SELECT url, fileId, message_id, created_at, file_name, file_size, mime_type
         FROM files 
         WHERE file_name LIKE ? ESCAPE '!'
         COLLATE NOCASE
         ORDER BY created_at DESC
      `).bind(searchPattern).all();
      return new Response(
        JSON.stringify({ files: files.results || [] }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      console.error(`[Search Error] ${error.message}`);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }
  function getPreviewHtml(url) {
    const ext = (url.split('.').pop() || '').toLowerCase();
    const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'icon'].includes(ext);
    const isVideo = ['mp4', 'webm'].includes(ext);
    const isAudio = ['mp3', 'wav', 'ogg'].includes(ext);
    if (isImage) {
      return `<img src="${url}" alt="预览">`;
    } else if (isVideo) {
      return `<video src="${url}" controls></video>`;
    } else if (isAudio) {
      return `<audio src="${url}" controls></audio>`;
    } else {
      return `<div style="font-size: 48px">📄</div>`;
    }
  }
  async function handleFileRequest(request, config) {
    try {
      const url = new URL(request.url);
      const path = decodeURIComponent(url.pathname.slice(1));
      if (!path) {
        return new Response('Not Found', { status: 404 });
      }
      
      // 检查缓存
      const cacheKey = `file:${path}`;
      if (config.fileCache && config.fileCache.has(cacheKey)) {
        const cachedData = config.fileCache.get(cacheKey);
        if (Date.now() - cachedData.timestamp < config.fileCacheTTL) {
          console.log(`从缓存提供文件: ${path}`);
          return cachedData.response.clone();
        } else {
          // 缓存过期，删除
          config.fileCache.delete(cacheKey);
        }
      }
      
      // 辅助函数：缓存并返回响应
      const cacheAndReturnResponse = (response) => {
        if (config.fileCache) {
          config.fileCache.set(cacheKey, {
            response: response.clone(),
            timestamp: Date.now()
          });
        }
        return response;
      };
      
      const getCommonHeaders = (contentType) => {
        const headers = new Headers();
        headers.set('Content-Type', contentType);
        headers.set('Access-Control-Allow-Origin', '*');
        if (contentType.startsWith('image/') || 
            contentType.startsWith('video/') || 
            contentType.startsWith('audio/')) {
          headers.set('Content-Disposition', 'inline');
        }
        headers.set('Cache-Control', 'public, max-age=31536000');
        return headers;
      };
      
      // 尝试从R2存储桶直接获取文件
      if (config.bucket) {
        try {
          const object = await config.bucket.get(path);
          if (object) {
            const contentType = object.httpMetadata.contentType || getContentType(path.split('.').pop());
            const headers = getCommonHeaders(contentType);
            object.writeHttpMetadata(headers);
            headers.set('etag', object.httpEtag);
            return cacheAndReturnResponse(new Response(object.body, { headers }));
          }
        } catch (error) {
          if (error.name !== 'NoSuchKey') {
            console.error('R2获取文件错误:', error.name);
          }
        }
      }
      
      // 从数据库查找文件
      let file;
      const urlPattern = `https://${config.domain}/${path}`;
      file = await config.database.prepare('SELECT * FROM files WHERE url = ?').bind(urlPattern).first();
      
      if (!file) {
        file = await config.database.prepare('SELECT * FROM files WHERE fileId = ?').bind(path).first();
      }
      
      if (!file) {
        const fileName = path.split('/').pop();
        file = await config.database.prepare('SELECT * FROM files WHERE file_name = ?').bind(fileName).first();
      }
      
      if (!file) {
        return new Response('File not found', { status: 404 });
      }
      
      // 处理Telegram存储的文件
      if (file.storage_type === 'telegram') {
        try {
          const telegramFileId = file.fileId;
          if (!telegramFileId) {
            console.error('文件记录缺少Telegram fileId');
            return new Response('Missing Telegram file ID', { status: 500 });
          }
          
          const response = await fetch(`https://api.telegram.org/bot${config.tgBotToken}/getFile?file_id=${telegramFileId}`);
          const data = await response.json();
          
          if (!data.ok) {
            console.error('Telegram getFile 失败:', data.description);
            return new Response('Failed to get file from Telegram', { status: 500 });
          }
          
          const telegramUrl = `https://api.telegram.org/file/bot${config.tgBotToken}/${data.result.file_path}`;
          const fileResponse = await fetch(telegramUrl);
          
          if (!fileResponse.ok) {
            console.error(`从Telegram获取文件失败: ${fileResponse.status}`);
            return new Response('Failed to fetch file from Telegram', { status: fileResponse.status });
          }
          
          const contentType = file.mime_type || getContentType(path.split('.').pop());
          const headers = getCommonHeaders(contentType);
          return cacheAndReturnResponse(new Response(fileResponse.body, { headers }));
          
        } catch (error) {
          console.error('处理Telegram文件出错:', error.message);
          return new Response('Error processing Telegram file', { status: 500 });
        }
      } 
      // 处理R2存储的文件
      else if (file.storage_type === 'r2' && config.bucket) {
        try {
          const object = await config.bucket.get(file.fileId);
          if (object) {
            const contentType = object.httpMetadata.contentType || file.mime_type || getContentType(path.split('.').pop());
            const headers = getCommonHeaders(contentType);
            object.writeHttpMetadata(headers);
            headers.set('etag', object.httpEtag);
            return cacheAndReturnResponse(new Response(object.body, { headers }));
          }
        } catch (error) {
          console.error('通过fileId从R2获取文件出错:', error.message);
        }
      }
      
      // 如果文件URL与请求的不同，重定向到正确的URL
      if (file.url && file.url !== urlPattern) {
        return Response.redirect(file.url, 302);
      }
      
      return new Response('File not available', { status: 404 });
    } catch (error) {
      console.error('处理文件请求出错:', error.message);
      return new Response('Internal Server Error', { status: 500 });
    }
  }
  async function handleDeleteRequest(request, config) {
    if (config.enableAuth && !authenticate(request, config)) {
      return Response.redirect(`${new URL(request.url).origin}/`, 302);
    }
    try {
      const { id, fileId } = await request.json();
      if (!id && !fileId) {
        return new Response(JSON.stringify({
          status: 0,
          message: '缺少文件标识信息'
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      let file;
      if (id && id.startsWith('http')) {
        file = await config.database.prepare('SELECT * FROM files WHERE url = ?').bind(id).first();
      } else if (id) {
        file = await config.database.prepare('SELECT * FROM files WHERE id = ?').bind(id).first();
      }
      if (!file && fileId) {
        file = await config.database.prepare('SELECT * FROM files WHERE fileId = ?').bind(fileId).first();
      }
      if (!file) {
        return new Response(JSON.stringify({
          status: 0,
          message: '文件不存在'
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      console.log('准备删除文件:', {
        fileId: file.fileId,
        url: file.url,
        存储类型: file.storage_type
      });
      if (file.storage_type === 'r2' && config.bucket) {
        await deleteFile(file.fileId, config);
        console.log('已从R2存储中删除文件:', file.fileId);
      }
      await config.database.prepare('DELETE FROM files WHERE id = ?').bind(file.id).run();
      console.log('已从数据库中删除文件记录');
      return new Response(JSON.stringify({
        status: 1,
        message: '删除成功'
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('删除文件失败:', error);
      return new Response(JSON.stringify({
        status: 0,
        message: '删除文件失败: ' + error.message
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
  function getContentType(ext) {
    const types = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      avif: 'image/avif',
      ico: 'image/x-icon',
      icon: 'image/x-icon',
      bmp: 'image/bmp',
      tiff: 'image/tiff',
      tif: 'image/tiff',
      mp4: 'video/mp4',
      webm: 'video/webm',
      ogg: 'video/ogg',
      ogv: 'video/ogg',
      avi: 'video/x-msvideo',
      mov: 'video/quicktime',
      wmv: 'video/x-ms-wmv',
      flv: 'video/x-flv',
      mkv: 'video/x-matroska',
      m4v: 'video/x-m4v',
      ts: 'video/mp2t',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      m4a: 'audio/mp4',
      aac: 'audio/aac',
      flac: 'audio/flac',
      wma: 'audio/x-ms-wma',
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      rtf: 'application/rtf',
      txt: 'text/plain',
      md: 'text/markdown',
      csv: 'text/csv',
      html: 'text/html',
      htm: 'text/html',
      css: 'text/css',
      js: 'application/javascript',
      xml: 'application/xml',
      json: 'application/json',
      zip: 'application/zip',
      rar: 'application/x-rar-compressed',
      '7z': 'application/x-7z-compressed',
      tar: 'application/x-tar',
      gz: 'application/gzip',
      swf: 'application/x-shockwave-flash',
      ttf: 'font/ttf',
      otf: 'font/otf',
      woff: 'font/woff',
      woff2: 'font/woff2',
      eot: 'application/vnd.ms-fontobject',
      ini: 'text/plain',
      yml: 'application/yaml',
      yaml: 'application/yaml',
      toml: 'text/plain',
      py: 'text/x-python',
      java: 'text/x-java',
      c: 'text/x-c',
      cpp: 'text/x-c++',
      cs: 'text/x-csharp',
      php: 'application/x-php',
      rb: 'text/x-ruby',
      go: 'text/x-go',
      rs: 'text/x-rust',
      sh: 'application/x-sh',
      bat: 'application/x-bat',
      sql: 'application/sql'
    };
    const lowerExt = ext.toLowerCase();
    return types[lowerExt] || 'application/octet-stream';
  }
  async function handleBingImagesRequest() {
    const cache = caches.default;
    const cacheKey = new Request('https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=5');
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      console.log('Returning cached response');
      return cachedResponse;
    }
    try {
      const res = await fetch(cacheKey);
      if (!res.ok) {
        console.error(`Bing API 请求失败，状态码：${res.status}`);
        return new Response('请求 Bing API 失败', { status: res.status });
      }
      const bingData = await res.json();
      const images = bingData.images.map(image => ({ url: `https://cn.bing.com${image.url}` }));
      const returnData = { status: true, message: "操作成功", data: images };
      const response = new Response(JSON.stringify(returnData), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=21600',
          'Access-Control-Allow-Origin': '*'
        }
      });
      await cache.put(cacheKey, response.clone());
      console.log('响应数据已缓存');
      return response;
    } catch (error) {
      console.error('请求 Bing API 过程中发生错误:', error);
      return new Response('请求 Bing API 失败', { status: 500 });
    }
  }
  function formatSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }
  function formatDate(timestamp) {
    if (!timestamp) return '未知时间';
    let date;
    if (typeof timestamp === 'number') {
      date = timestamp > 9999999999 ? new Date(timestamp) : new Date(timestamp * 1000);
    } 
    else if (typeof timestamp === 'string') {
      date = new Date(timestamp);
      if (isNaN(date.getTime())) {
        const numTimestamp = parseInt(timestamp);
        if (!isNaN(numTimestamp)) {
          date = numTimestamp > 9999999999 ? new Date(numTimestamp) : new Date(numTimestamp * 1000);
        }
      }
    }
    else {
      date = new Date();
    }
    if (isNaN(date.getTime()) || date.getFullYear() < 2000) {
      return '日期无效';
    }
    return date.toLocaleString();
  }
  async function sendMessage(chatId, text, botToken, replyToMessageId = null) {
    try {
      const messageData = {
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML'
      };
      if (replyToMessageId) {
        messageData.reply_to_message_id = replyToMessageId;
      }
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messageData)
      });
      if (!response.ok) {
        const errorData = await response.json();
        console.error('发送消息失败:', errorData);
        return null;
      }
      return await response.json();
    } catch (error) {
      console.error('发送消息时出错:', error);
      return null;
    }
  }
  function generateLoginPage() {
    return `<!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <link rel="shortcut icon" href="https://tc-212.pages.dev/1744301785698.ico" type="image/x-icon">
      <meta name="description" content="Telegram文件存储与分享平台">
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>登录</title>
      <style>
        body {
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          background: linear-gradient(135deg, #74ebd5, #acb6e5);
          font-family: 'Segoe UI', Arial, sans-serif;
          margin: 0;
        }
        .login-container {
          background: rgba(255, 255, 255, 0.95);
          padding: 2rem 3rem;
          border-radius: 15px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.1);
          width: 100%;
          max-width: 400px;
        }
        h2 {
          text-align: center;
          color: #333;
          margin-bottom: 2rem;
          font-size: 1.5rem;
        }
        .form-group {
          margin-bottom: 1rem;
        }
        input {
          width: 100%;
          padding: 0.75rem;
          border: 2px solid #ddd;
          border-radius: 8px;
          font-size: 1rem;
          background: #fff;
          transition: border-color 0.3s ease;
        }
        input:focus {
          outline: none;
          border-color: #007bff;
        }
        button {
          width: 100%;
          padding: 0.75rem;
          background: #007bff;
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 1rem;
          cursor: pointer;
          transition: background 0.3s ease;
        }
        button:hover {
          background: #0056b3;
        }
        .modal {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.7);
          justify-content: center;
          align-items: center;
          z-index: 1000;
          opacity: 0;
          transition: opacity 0.3s ease;
        }
        .modal.show {
          display: flex;
          opacity: 1;
        }
        .modal-content {
          background: white;
          padding: 1.5rem 2rem;
          border-radius: 15px;
          box-shadow: 0 15px 40px rgba(0,0,0,0.3);
          text-align: center;
          color: #dc3545;
          font-size: 1rem;
          transform: scale(0.9);
          transition: transform 0.3s ease;
        }
        .modal.show .modal-content {
          transform: scale(1);
        }
      </style>
    </head>
    <body>
      <div class="login-container">
        <h2>登录</h2>
        <form id="loginForm">
          <div class="form-group">
            <input type="text" id="username" placeholder="用户名" required>
          </div>
          <div class="form-group">
            <input type="password" id="password" placeholder="密码" required>
          </div>
          <button type="submit">登录</button>
        </form>
      </div>
      <div id="notification" class="modal">
        <div class="modal-content">用户名或密码错误</div>
      </div>
      <script>
        document.addEventListener('DOMContentLoaded', function() {
          async function setBingBackground() {
            try {
              const response = await fetch('/bing', { cache: 'no-store' });
              const data = await response.json();
              if (data.status && data.data && data.data.length > 0) {
                const randomIndex = Math.floor(Math.random() * data.data.length);
                document.body.style.backgroundImage = \`url(\${data.data[randomIndex].url})\`;
              }
            } catch (error) {
              console.error('获取背景图失败:', error);
            }
          }
          setBingBackground();
          setInterval(setBingBackground, 3600000);
          const loginForm = document.getElementById('loginForm');
          if (loginForm) {
            loginForm.addEventListener('submit', async (e) => {
              e.preventDefault();
              const username = document.getElementById('username').value;
              const password = document.getElementById('password').value;
              try {
                const response = await fetch('/', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ username, password })
                });
                if (response.ok) {
                  window.location.href = '/upload';
                } else {
                  const notification = document.getElementById('notification');
                  if (notification) {
                    notification.classList.add('show');
                    setTimeout(() => notification.classList.remove('show'), 3000);
                  }
                }
              } catch (err) {
                console.error('登录失败:', err);
                const notification = document.getElementById('notification');
                if (notification) {
                  notification.classList.add('show');
                  setTimeout(() => notification.classList.remove('show'), 3000);
                }
              }
            });
          }
        });
      </script>
    </body>
    </html>`;
  }
  function generateUploadPage(categoryOptions, storageType) {
    return `<!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <link rel="shortcut icon" href="https://tc-212.pages.dev/1744301785698.ico" type="image/x-icon">
      <meta name="description" content="Telegram文件存储与分享平台">
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>文件上传</title>
      <style>
        body {
          font-family: 'Segoe UI', Arial, sans-serif;
          margin: 0;
          padding: 0;
          min-height: 100vh;
          background: linear-gradient(135deg, #f0f4f8, #d9e2ec);
          display: flex;
          justify-content: center;
          align-items: center;
        }
        .container {
          max-width: 900px;
          width: 100%;
          background: rgba(255, 255, 255, 0.95);
          border-radius: 15px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.1);
          padding: 2rem;
          margin: 20px;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1.5rem;
        }
        h1 {
          color: #2c3e50;
          margin: 0;
          font-size: 1.8rem;
          font-weight: 600;
        }
        .admin-link {
          color: #3498db;
          text-decoration: none;
          font-size: 1rem;
          transition: color 0.3s ease;
        }
        .admin-link:hover {
          color: #2980b9;
        }
        .options {
          display: flex;
          gap: 1rem;
          margin-bottom: 1.5rem;
          flex-wrap: wrap;
        }
        .category-select, .new-category input {
          padding: 0.8rem;
          border: 2px solid #dfe6e9;
          border-radius: 8px;
          font-size: 1rem;
          background: #fff;
          transition: border-color 0.3s ease, box-shadow 0.3s ease;
          box-shadow: 0 2px 5px rgba(0,0,0,0.05);
        }
        .category-select:focus, .new-category input:focus {
          outline: none;
          border-color: #3498db;
          box-shadow: 0 0 8px rgba(52,152,219,0.3);
        }
        .new-category {
          display: flex;
          gap: 1rem;
          align-items: center;
        }
        .new-category button {
          padding: 0.8rem 1.5rem;
          background: #2ecc71;
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: background 0.3s ease, transform 0.3s ease;
          box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }
        .new-category button:hover {
          background: #27ae60;
          transform: translateY(-2px);
        }
        .storage-toggle {
          display: flex;
          gap: 0.5rem;
        }
        .storage-btn {
          padding: 0.8rem 1.5rem;
          border: 2px solid #dfe6e9;
          border-radius: 8px;
          background: #fff;
          cursor: pointer;
          transition: all 0.3s ease;
          box-shadow: 0 2px 5px rgba(0,0,0,0.05);
        }
        .storage-btn.active {
          background: #3498db;
          color: white;
          border-color: #3498db;
        }
        .storage-btn:hover:not(.active) {
          background: #ecf0f1;
          transform: translateY(-2px);
        }
        .upload-area {
          border: 2px dashed #b2bec3;
          padding: 2rem;
          text-align: center;
          margin-bottom: 1.5rem;
          border-radius: 10px;
          background: #fff;
          transition: all 0.3s ease;
          box-shadow: 0 2px 10px rgba(0,0,0,0.05);
        }
        .upload-area.dragover {
          border-color: #3498db;
          background: #f8f9fa;
          box-shadow: 0 0 15px rgba(52,152,219,0.2);
        }
        .upload-area p {
          margin: 0;
          color: #7f8c8d;
          font-size: 1.1rem;
        }
        .preview-area {
          margin-top: 1rem;
        }
        .preview-item {
          display: flex;
          align-items: center;
          padding: 1rem;
          background: #fff;
          border-radius: 8px;
          margin-bottom: 1rem;
          box-shadow: 0 2px 5px rgba(0,0,0,0.05);
          transition: transform 0.3s ease;
        }
        .preview-item:hover {
          transform: translateY(-2px);
        }
        .preview-item img {
          max-width: 100px;
          max-height: 100px;
          margin-right: 1rem;
          border-radius: 5px;
        }
        .preview-item .info {
          flex-grow: 1;
          color: #2c3e50;
        }
        .progress-bar {
          height: 20px;
          background: #ecf0f1;
          border-radius: 10px;
          margin: 8px 0;
          overflow: hidden;
          position: relative;
        }
        .progress-track {
          height: 100%;
          background: #3498db;
          transition: width 0.3s ease;
          width: 0;
        }
        .progress-text {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          color: #fff;
          font-size: 12px;
        }
        .success .progress-track {
          background: #2ecc71;
        }
        .error .progress-track {
          background: #e74c3c;
        }
        .url-area {
          margin-top: 1.5rem;
        }
        .url-area textarea {
          width: 100%;
          min-height: 100px;
          padding: 0.8rem;
          border: 2px solid #dfe6e9;
          border-radius: 8px;
          background: #fff;
          font-size: 0.9rem;
          resize: vertical;
          transition: border-color 0.3s ease;
        }
        .url-area textarea:focus {
          outline: none;
          border-color: #3498db;
        }
        .button-group {
          margin-top: 1rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 1rem;
        }
        .button-container button {
          padding: 0.7rem 1.2rem;
          border: none;
          border-radius: 8px;
          background: #3498db;
          color: white;
          cursor: pointer;
          transition: background 0.3s ease, transform 0.3s ease;
          box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }
        .button-container button:hover {
          background: #2980b9;
          transform: translateY(-2px);
        }
        .copyright {
          font-size: 0.8rem;
          color: #7f8c8d;
        }
        .copyright a {
          color: #3498db;
          text-decoration: none;
        }
        .copyright a:hover {
          text-decoration: underline;
        }
        .modal {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.7);
          justify-content: center;
          align-items: center;
          z-index: 1000;
          opacity: 0;
          transition: opacity 0.3s ease;
        }
        .modal.show {
          display: flex;
          opacity: 1;
        }
        .modal-content {
          background: white;
          padding: 2rem;
          border-radius: 15px;
          box-shadow: 0 15px 40px rgba(0,0,0,0.3);
          text-align: center;
          width: 90%;
          max-width: 400px;
          transform: scale(0.9);
          transition: transform 0.3s ease;
        }
        .modal.show .modal-content {
          transform: scale(1);
        }
        .modal-title {
          color: #2c3e50;
          font-size: 1.3rem;
          margin-top: 0;
          margin-bottom: 1rem;
        }
        .modal-message {
          margin-bottom: 1.5rem;
          color: #34495e;
          line-height: 1.5;
        }
        .modal-buttons {
          display: flex;
          gap: 1rem;
          justify-content: center;
        }
        .modal-button {
          padding: 0.8rem 1.8rem;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.3s ease;
          box-shadow: 0 2px 5px rgba(0,0,0,0.1);
          font-size: 0.95rem;
          font-weight: 500;
        }
        .modal-confirm {
          background: #3498db;
          color: white;
        }
        .modal-cancel {
          background: #95a5a6;
          color: white;
        }
        .modal-button:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 8px rgba(0,0,0,0.15);
        }
        .modal-confirm:hover {
          background: #2980b9;
        }
        .modal-cancel:hover {
          background: #7f8c8d;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>文件上传</h1>
          <a href="/admin" class="admin-link">管理文件</a>
        </div>
        <div class="options">
          <select id="categorySelect" class="category-select">
            <option value="">选择分类</option>
            ${categoryOptions}
          </select>
          <div class="new-category">
            <input type="text" id="newCategoryInput" placeholder="输入新分类名称">
            <button onclick="createNewCategory()">新建分类</button>
          </div>
          <div class="storage-toggle">
            <button class="storage-btn ${storageType === 'telegram' ? 'active' : ''}" data-storage="telegram">Telegram</button>
            <button class="storage-btn ${storageType === 'r2' ? 'active' : ''}" data-storage="r2">R2</button>
          </div>
        </div>
        <div class="upload-area" id="uploadArea">
          <p>点击选择 或 拖拽文件到此处</p>
          <input type="file" id="fileInput" multiple style="display: none">
        </div>
        <div class="preview-area" id="previewArea"></div>
        <div class="url-area">
          <textarea id="urlArea" readonly placeholder="上传完成后的链接将显示在这里"></textarea>
          <div class="button-group">
            <div class="button-container">
              <button onclick="copyUrls('url')">复制URL</button>
              <button onclick="copyUrls('markdown')">复制Markdown</button>
              <button onclick="copyUrls('html')">复制HTML</button>
            </div>
            <div class="copyright">
              <span>© 2025 Copyright by <a href="https://github.com/iawooo/cftc" target="_blank">AWEI's GitHub</a> | <a href="https://awbk.pp.ua/" target="_blank">阿伟</a></span>
            </div>
          </div>
        </div>
        <!-- 通用确认弹窗 -->
        <div id="confirmModal" class="modal">
          <div class="modal-content">
            <h3 class="modal-title">提示</h3>
            <p class="modal-message" id="confirmModalMessage"></p>
            <div class="modal-buttons">
              <button class="modal-button modal-confirm" id="confirmModalConfirm">确认</button>
              <button class="modal-button modal-cancel" id="confirmModalCancel">取消</button>
            </div>
          </div>
        </div>
      </div>
      <script>
        async function setBingBackground() {
          try {
            const response = await fetch('/bing', { cache: 'no-store' });
            const data = await response.json();
            if (data.status && data.data && data.data.length > 0) {
              const randomIndex = Math.floor(Math.random() * data.data.length);
              document.body.style.backgroundImage = \`url(\${data.data[randomIndex].url})\`;
            }
          } catch (error) {
            console.error('获取背景图失败:', error);
          }
        }
        setBingBackground();
        setInterval(setBingBackground, 3600000);
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('fileInput');
        const previewArea = document.getElementById('previewArea');
        const urlArea = document.getElementById('urlArea');
        const categorySelect = document.getElementById('categorySelect');
        const newCategoryInput = document.getElementById('newCategoryInput');
        const storageButtons = document.querySelectorAll('.storage-btn');
        const confirmModal = document.getElementById('confirmModal');
        const confirmModalMessage = document.getElementById('confirmModalMessage');
        const confirmModalConfirm = document.getElementById('confirmModalConfirm');
        const confirmModalCancel = document.getElementById('confirmModalCancel');
        let uploadedUrls = [];
        let currentConfirmCallback = null;
        storageButtons.forEach(btn => {
          btn.addEventListener('click', () => {
            storageButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
          });
        });
        async function createNewCategory() {
          const categoryName = newCategoryInput.value.trim();
          if (!categoryName) {
            showConfirmModal('分类名称不能为空！', null, true);
            return;
          }
          try {
            const response = await fetch('/create-category', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: categoryName })
            });
            const data = await response.json();
            if (data.status === 1) {
              const option = document.createElement('option');
              option.value = data.category.id;
              option.textContent = data.category.name;
              categorySelect.appendChild(option);
              categorySelect.value = data.category.id;
              newCategoryInput.value = '';
              showConfirmModal(data.msg, null, true);
            } else {
              showConfirmModal(data.msg, null, true);
            }
          } catch (error) {
            showConfirmModal('创建分类失败：' + error.message, null, true);
          }
        }
        function showConfirmModal(message, callback, alertOnly = false) {
          closeConfirmModal();
          confirmModalMessage.textContent = message;
          currentConfirmCallback = callback;
          if (alertOnly) {
            confirmModalConfirm.textContent = '确定';
            confirmModalCancel.style.display = 'none';
          } else {
            confirmModalConfirm.textContent = '确认';
            confirmModalCancel.style.display = 'inline-block';
          }
          confirmModal.classList.add('show');
        }
        function closeConfirmModal() {
          confirmModal.classList.remove('show');
        }
        confirmModalConfirm.addEventListener('click', () => {
          if (currentConfirmCallback) {
            currentConfirmCallback();
          }
          closeConfirmModal();
        });
        confirmModalCancel.addEventListener('click', closeConfirmModal);
        window.addEventListener('click', (event) => {
          if (event.target === confirmModal) {
            closeConfirmModal();
          }
          const qrModal = document.getElementById('qrModal');
          if (event.target === qrModal) {
            qrModal.style.display = 'none';
          }
          if (event.target === editSuffixModal) {
            editSuffixModal.classList.remove('show');
          }
        });
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
          uploadArea.addEventListener(eventName, preventDefaults, false);
          document.body.addEventListener(eventName, preventDefaults, false);
        });
        function preventDefaults(e) {
          e.preventDefault();
          e.stopPropagation();
        }
        ['dragenter', 'dragover'].forEach(eventName => {
          uploadArea.addEventListener(eventName, highlight, false);
        });
        ['dragleave', 'drop'].forEach(eventName => {
          uploadArea.addEventListener(eventName, unhighlight, false);
        });
        function highlight(e) {
          uploadArea.classList.add('dragover');
        }
        function unhighlight(e) {
          uploadArea.classList.remove('dragover');
        }
        uploadArea.addEventListener('drop', handleDrop, false);
        uploadArea.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', handleFiles);
        function handleDrop(e) {
          const dt = e.dataTransfer;
          const files = dt.files;
          handleFiles({ target: { files } });
        }
        document.addEventListener('paste', async (e) => {
          const items = (e.clipboardData || e.originalEvent.clipboardData).items;
          for (let item of items) {
            if (item.kind === 'file') {
              const file = item.getAsFile();
              await uploadFile(file);
            }
          }
        });
        async function handleFiles(e) {
          const response = await fetch('/config');
          if (!response.ok) {
            throw new Error('Failed to fetch config');
          }
          const config = await response.json();
          const files = Array.from(e.target.files);
          for (let file of files) {
            if (file.size > config.maxSizeMB * 1024 * 1024) {
              showConfirmModal(\`文件超过\${config.maxSizeMB}MB限制\`, null, true);
              return;
            }
            await uploadFile(file);
          }
        }
        async function uploadFile(file) {
          const preview = createPreview(file);
          previewArea.appendChild(preview);
          const xhr = new XMLHttpRequest();
          const progressTrack = preview.querySelector('.progress-track');
          const progressText = preview.querySelector('.progress-text');
          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
              const percent = Math.round((e.loaded / e.total) * 100);
              progressTrack.style.width = \`\${percent}%\`;
              progressText.textContent = \`\${percent}%\`;
            }
          });
          xhr.addEventListener('load', () => {
            try {
              const data = JSON.parse(xhr.responseText);
              const progressText = preview.querySelector('.progress-text');
              if (xhr.status >= 200 && xhr.status < 300 && data.status === 1) {
                progressText.textContent = data.msg;
                uploadedUrls.push(data.url);
                updateUrlArea();
                preview.classList.add('success');
              } else {
                const errorMsg = [data.msg, data.error || '未知错误'].filter(Boolean).join(' | ');
                progressText.textContent = errorMsg;
                preview.classList.add('error');
              }
            } catch (e) {
              preview.querySelector('.progress-text').textContent = '✗ 响应解析失败';
              preview.classList.add('error');
            }
          });
          const formData = new FormData();
          formData.append('file', file);
          formData.append('category', categorySelect.value);
          formData.append('storage_type', document.querySelector('.storage-btn.active').dataset.storage);
          xhr.open('POST', '/upload');
          xhr.send(formData);
        }
        function createPreview(file) {
          const div = document.createElement('div');
          div.className = 'preview-item';
          if (file.type.startsWith('image/')) {
            const img = document.createElement('img');
            img.src = URL.createObjectURL(file);
            div.appendChild(img);
          }
          const info = document.createElement('div');
          info.className = 'info';
          info.innerHTML = \`
            <div>\${file.name}</div>
            <div>\${formatSize(file.size)}</div>
            <div class="progress-bar">
              <div class="progress-track"></div>
              <span class="progress-text">0%</span>
            </div>
          \`;
          div.appendChild(info);
          return div;
        }
        function formatSize(bytes) {
          const units = ['B', 'KB', 'MB', 'GB'];
          let size = bytes;
          let unitIndex = 0;
          while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
          }
          return \`\${size.toFixed(2)} \${units[unitIndex]}\`;
        }
        function updateUrlArea() {
          urlArea.value = uploadedUrls.join('\\n');
        }
        function copyUrls(format) {
          let text = '';
          switch (format) {
            case 'url':
              text = uploadedUrls.join('\\n');
              break;
            case 'markdown':
              text = uploadedUrls.map(url => \`![](\${url})\`).join('\\n');
              break;
            case 'html':
              text = uploadedUrls.map(url => \`<img src="\${url}" />\`).join('\\n');
              break;
          }
          navigator.clipboard.writeText(text)
            .then(() => {
              showConfirmModal('已复制到剪贴板', null, true);
            })
            .catch(() => {
              showConfirmModal('复制失败，请手动复制', null, true);
            });
        }
      </script>
    </body>
    </html>`;
  }
  function generateAdminPage(fileCards, categoryOptions) {
    return `<!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <link rel="shortcut icon" href="https://tc-212.pages.dev/1744301785698.ico" type="image/x-icon">
      <meta name="description" content="Telegram文件存储与分享平台">
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>文件管理</title>
      <!-- 确保QR码库在页面加载前就可用 -->
      <script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
      <style>
        body {
          font-family: 'Segoe UI', Arial, sans-serif;
          margin: 0;
          padding: 20px;
          min-height: 100vh;
          background: linear-gradient(135deg, #f0f4f8, #d9e2ec);
        }
        .container {
          max-width: 1200px;
          margin: 0 auto;
        }
        .header {
          background: rgba(255, 255, 255, 0.95);
          padding: 1.5rem;
          border-radius: 15px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.1);
          margin-bottom: 1.5rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        h2 {
          color: #2c3e50;
          margin: 0;
          font-size: 1.8rem;
        }
        .right-content {
          display: flex;
          gap: 1rem;
          align-items: center;
        }
        .search, .category-filter {
          padding: 0.7rem;
          border: 2px solid #dfe6e9;
          border-radius: 8px;
          font-size: 0.9rem;
          background: #fff;
          transition: border-color 0.3s ease;
          box-shadow: 0 2px 5px rgba(0,0,0,0.05);
        }
        .search:focus, .category-filter:focus {
          outline: none;
          border-color: #3498db;
        }
        .backup {
          color: #3498db;
          text-decoration: none;
          font-size: 1rem;
          transition: color 0.3s ease;
        }
        .backup:hover {
          color: #2980b9;
        }
        .return-btn {
          background: #2ecc71;
          color: white;
          padding: 0.7rem 1.5rem;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 0.9rem;
          transition: all 0.3s ease;
          text-decoration: none;
          margin-left: 10px;
        }
        .return-btn:hover {
          background: #27ae60;
          transform: translateY(-2px);
        }
        .action-bar {
          background: rgba(255, 255, 255, 0.95);
          padding: 1.5rem;
          border-radius: 15px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.1);
          margin-bottom: 1.5rem;
          display: flex;
          gap: 1rem;
          align-items: center;
          justify-content: space-between;
        }
        .action-bar-left {
          display: flex;
          gap: 1rem;
          align-items: center;
        }
        .action-bar-right {
          display: flex;
          gap: 1rem;
          align-items: center;
        }
        .action-bar h3 {
          margin: 0;
          color: #2c3e50;
          font-size: 1.2rem;
        }
        .action-bar select {
          padding: 0.7rem;
          border: 2px solid #dfe6e9;
          border-radius: 8px;
          font-size: 0.9rem;
          background: #fff;
          transition: border-color 0.3s ease;
        }
        .action-bar select:focus {
          outline: none;
          border-color: #3498db;
        }
        .action-button {
          padding: 0.7rem 1.5rem;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.3s ease;
          box-shadow: 0 2px 5px rgba(0,0,0,0.1);
          font-size: 0.9rem;
        }
        .select-all-btn {
          background: #3498db;
          color: white;
        }
        .delete-files-btn {
          background: #e74c3c;
          color: white;
        }
        .delete-category-btn {
          background: #e74c3c;
          color: white;
        }
        .action-button:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 8px rgba(0,0,0,0.15);
        }
        .select-all-btn:hover {
          background: #2980b9;
        }
        .delete-files-btn:hover {
          background: #c0392b;
        }
        .delete-category-btn:hover {
          background: #c0392b;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
          gap: 1.5rem;
        }
        .file-card {
          background: rgba(255, 255, 255, 0.95);
          border-radius: 15px;
          box-shadow: 0 5px 15px rgba(0,0,0,0.1);
          overflow: hidden;
          position: relative;
          transition: all 0.3s ease;
          cursor: pointer;
        }
        .file-card:hover {
          transform: translateY(-5px);
          box-shadow: 0 8px 20px rgba(0,0,0,0.15);
        }
        .file-card.selected {
          border: 3px solid #3498db;
        }
        .file-checkbox {
          position: absolute;
          top: 10px;
          left: 10px;
          z-index: 5;
          width: 20px;
          height: 20px;
        }
        .file-preview {
          height: 150px;
          background: #f8f9fa;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .file-preview img, .file-preview video {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
        }
        .file-info {
          padding: 1rem;
          font-size: 0.9rem;
          color: #2c3e50;
        }
        .file-actions {
          padding: 1rem;
          border-top: 1px solid #eee;
          display: flex;
          justify-content: space-between;
          gap: 0.5rem;
        }
        .btn {
          padding: 0.5rem 1rem;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.3s ease;
          box-shadow: 0 2px 5px rgba(0,0,0,0.1);
          font-size: 0.9rem;
          display: inline-block;
          text-align: center;
        }
        .btn-share {
          background: #3498db;
          color: white;
          flex: 1;
        }
        .btn-down {
          background: #2ecc71;
          color: white;
          text-decoration: none;
          flex: 1;
        }
        .btn-delete {
          background: #e74c3c;
          color: white;
          flex: 1;
        }
        .btn-edit {
          background: #f39c12;
          color: white;
          flex: 1;
        }
        .btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 8px rgba(0,0,0,0.15);
        }
        .btn-share:hover {
          background: #2980b9;
        }
        .btn-down:hover {
          background: #27ae60;
        }
        .btn-delete:hover {
          background: #c0392b;
        }
        .btn-edit:hover {
          background: #e67e22;
        }
        .modal {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.7);
          justify-content: center;
          align-items: center;
          z-index: 1000;
          opacity: 0;
          transition: opacity 0.3s ease;
        }
        .modal.show {
          display: flex;
          opacity: 1;
        }
        .modal-content {
          background: white;
          padding: 2rem;
          border-radius: 15px;
          box-shadow: 0 15px 40px rgba(0,0,0,0.3);
          text-align: center;
          width: 90%;
          max-width: 400px;
          transform: scale(0.9);
          transition: transform 0.3s ease;
        }
        .modal.show .modal-content {
          transform: scale(1);
        }
        .modal-title {
          color: #2c3e50;
          font-size: 1.3rem;
          margin-top: 0;
          margin-bottom: 1rem;
        }
        .modal-message {
          margin-bottom: 1.5rem;
          color: #34495e;
          line-height: 1.5;
        }
        .modal-buttons {
          display: flex;
          gap: 1rem;
          justify-content: center;
        }
        .modal-button {
          padding: 0.8rem 1.8rem;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.3s ease;
          box-shadow: 0 2px 5px rgba(0,0,0,0.1);
          font-size: 0.95rem;
          font-weight: 500;
        }
        .modal-confirm {
          background: #3498db;
          color: white;
        }
        .modal-cancel {
          background: #95a5a6;
          color: white;
        }
        .modal-button:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 8px rgba(0,0,0,0.15);
        }
        .modal-confirm:hover {
          background: #2980b9;
        }
        .modal-cancel:hover {
          background: #7f8c8d;
        }
        #qrModal {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.7);
          justify-content: center;
          align-items: center;
          z-index: 1000;
          opacity: 0;
          transition: opacity 0.3s ease;
        }
        #qrModal.show {
          display: flex;
          opacity: 1;
        }
        .qr-content {
          background: white;
          padding: 2rem;
          border-radius: 15px;
          box-shadow: 0 15px 40px rgba(0,0,0,0.3);
          text-align: center;
          width: 90%;
          max-width: 350px;
          transform: scale(0.9);
          transition: transform 0.3s ease;
        }
        #qrModal.show .qr-content {
          transform: scale(1);
        }
        .qr-title {
          color: #2c3e50;
          font-size: 1.3rem;
          margin-top: 0;
          margin-bottom: 0.5rem;
        }
        .qr-file-name {
          color: #7f8c8d;
          font-size: 0.9rem;
          margin-bottom: 1rem;
          word-break: break-all;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        #qrcode {
          margin: 1.5rem auto;
        }
        .qr-buttons {
          display: flex;
          gap: 0.5rem;
          justify-content: center;
          margin-top: 1.5rem;
        }
        .qr-copy, .qr-download, .qr-close {
          padding: 0.8rem 1rem;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.3s ease;
          box-shadow: 0 2px 5px rgba(0,0,0,0.1);
          font-size: 0.9rem;
          font-weight: 500;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .qr-copy {
          background: #3498db;
          color: white;
        }
        .qr-download {
          background: #2ecc71;
          color: white;
        }
        .qr-close {
          background: #95a5a6;
          color: white;
        }
        .qr-copy:hover, .qr-download:hover, .qr-close:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 8px rgba(0,0,0,0.15);
        }
        .qr-copy:hover {
          background: #2980b9;
        }
        .qr-download:hover {
          background: #27ae60;
        }
        .qr-close:hover {
          background: #7f8c8d;
        }
        #editSuffixModal {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.7);
          justify-content: center;
          align-items: center;
          z-index: 1000;
        }
        #editSuffixModal.show {
          display: flex;
        }
        #editSuffixModal .modal-content {
          background: white;
          padding: 2rem;
          border-radius: 15px;
          box-shadow: 0 15px 40px rgba(0,0,0,0.3);
          text-align: center;
          width: 90%;
          max-width: 400px;
        }
        #editSuffixModal input {
          width: 100%;
          padding: 0.8rem;
          margin: 1rem 0;
          border: 2px solid #dfe6e9;
          border-radius: 8px;
          font-size: 1rem;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>文件管理</h2>
          <div class="right-content">
            <input type="text" id="search-input" class="search" placeholder="搜索文件名...">
            <select id="category-filter" class="category-filter">
              <option value="">所有分类</option>
              ${categoryOptions}
            </select>
            <a href="javascript:void(0)" class="backup" onclick="downloadBackup()">备份数据</a>
            <a href="/upload" class="return-btn">返回上传</a>
          </div>
        </div>
        <div class="action-bar">
          <div class="action-bar-left">
            <h3>文件操作：</h3>
            <button class="action-button select-all-btn" id="selectAllBtn">全选/取消</button>
            <button class="action-button delete-files-btn" id="deleteFilesBtn">删除选中</button>
          </div>
          <div class="action-bar-right">
            <h3>分类管理：</h3>
            <select id="categoryDeleteSelect" name="categoryDeleteSelect">
              ${categoryOptions}
            </select>
            <button class="action-button delete-category-btn" id="deleteCategoryBtn">删除分类</button>
          </div>
        </div>
        <div class="grid" id="fileGrid">
          ${fileCards}
        </div>
        <!-- 确认删除弹窗 -->
        <div id="confirmModal" class="modal">
          <div class="modal-content">
            <h3 class="modal-title">确认操作</h3>
            <p class="modal-message" id="confirmModalMessage"></p>
            <div class="modal-buttons">
              <button class="modal-button modal-confirm" id="confirmModalConfirm">确认</button>
              <button class="modal-button modal-cancel" id="confirmModalCancel">取消</button>
            </div>
          </div>
        </div>
        <!-- 修改后缀弹窗 -->
        <div id="editSuffixModal" class="modal">
          <div class="modal-content">
            <h3 class="modal-title">修改文件后缀</h3>
            <input type="text" id="editSuffixInput" name="editSuffixInput" placeholder="输入新的文件后缀">
            <div class="modal-buttons">
              <button class="modal-button modal-confirm" id="editSuffixConfirm">确认</button>
              <button class="modal-button modal-cancel" id="editSuffixCancel">取消</button>
            </div>
          </div>
        </div>
      </div>
      <script>
        let currentShareUrl = '';
        let currentConfirmCallback = null;
        let currentEditUrl = '';
        async function setBingBackground() {
          try {
            const response = await fetch('/bing', { cache: 'no-store' });
            const data = await response.json();
            if (data.status && data.data && data.data.length > 0) {
              const randomIndex = Math.floor(Math.random() * data.data.length);
              document.body.style.backgroundImage = \`url(\${data.data[randomIndex].url})\`;
            }
          } catch (error) {
            console.error('获取背景图失败:', error);
          }
        }
        setTimeout(setBingBackground, 1000);
        document.addEventListener('DOMContentLoaded', function() {
          console.log('DOM已加载，初始化页面...');
          const searchInput = document.getElementById('search-input');
          const categoryFilter = document.getElementById('category-filter');
          const fileGrid = document.getElementById('fileGrid');
          const fileCards = Array.from(fileGrid?.children || []);
          const selectAllBtn = document.getElementById('selectAllBtn');
          const deleteFilesBtn = document.getElementById('deleteFilesBtn');
          const deleteCategoryBtn = document.getElementById('deleteCategoryBtn');
          confirmModal = document.getElementById('confirmModal');
          confirmModalMessage = document.getElementById('confirmModalMessage');
          confirmModalConfirm = document.getElementById('confirmModalConfirm');
          confirmModalCancel = document.getElementById('confirmModalCancel');
          editSuffixModal = document.getElementById('editSuffixModal');
          console.log('页面元素引用:', {
            confirmModal: !!confirmModal,
            editSuffixModal: !!editSuffixModal
          });
          if (searchInput) searchInput.addEventListener('input', filterFiles);
          if (categoryFilter) categoryFilter.addEventListener('change', filterFiles);
          if (selectAllBtn) selectAllBtn.addEventListener('click', toggleSelectAll);
          if (deleteFilesBtn) deleteFilesBtn.addEventListener('click', confirmDeleteSelected);
          if (deleteCategoryBtn) deleteCategoryBtn.addEventListener('click', confirmDeleteCategory);
          if (confirmModalConfirm) confirmModalConfirm.addEventListener('click', handleConfirmModalConfirm);
          if (confirmModalCancel) confirmModalCancel.addEventListener('click', closeConfirmModal);
          const editSuffixConfirm = document.getElementById('editSuffixConfirm');
          const editSuffixCancel = document.getElementById('editSuffixCancel');
          if (editSuffixCancel) {
            editSuffixCancel.addEventListener('click', () => {
              if (editSuffixModal) editSuffixModal.classList.remove('show');
            });
          }
          if (editSuffixConfirm) {
            editSuffixConfirm.addEventListener('click', updateFileSuffix);
          }
          window.addEventListener('click', handleWindowClick);
          initializeFileCards();
        });
        function initializeFileCards() {
          const fileGrid = document.getElementById('fileGrid');
          if (!fileGrid) return;
          const fileCards = Array.from(fileGrid.children);
          fileCards.forEach(card => {
            const checkbox = card.querySelector('.file-checkbox');
            if (!checkbox) return;
            card.addEventListener('click', (e) => {
              if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A' || 
                  e.target.closest('.btn') || e.target.closest('.file-actions')) {
                return;
              }
              checkbox.checked = !checkbox.checked;
              card.classList.toggle('selected', checkbox.checked);
              e.preventDefault(); 
            });
            checkbox.addEventListener('change', () => {
              card.classList.toggle('selected', checkbox.checked);
            });
          });
        }
        function filterFiles() {
          const searchInput = document.getElementById('search-input');
          const categoryFilter = document.getElementById('category-filter');
          const fileGrid = document.getElementById('fileGrid');
          if (!searchInput || !categoryFilter || !fileGrid) return;
          const searchTerm = searchInput.value.toLowerCase();
          const selectedCategory = categoryFilter.value;
          const fileCards = Array.from(fileGrid.children);
          fileCards.forEach(card => {
            const fileInfo = card.querySelector('.file-info');
            if (!fileInfo) return;
            const fileName = fileInfo.querySelector('div:first-child')?.textContent.toLowerCase() || '';
            const categoryId = card.getAttribute('data-category-id') || '';
            const matchesSearch = fileName.includes(searchTerm);
            const matchesCategory = selectedCategory === '' || categoryId === selectedCategory;
            card.style.display = matchesSearch && matchesCategory ? '' : 'none';
          });
        }
        function toggleSelectAll() {
          const fileGrid = document.getElementById('fileGrid');
          if (!fileGrid) return;
          const fileCards = Array.from(fileGrid.children);
          const visibleCards = fileCards.filter(card => card.style.display !== 'none');
          const allSelected = visibleCards.every(card => card.querySelector('.file-checkbox')?.checked);
          visibleCards.forEach(card => {
            const checkbox = card.querySelector('.file-checkbox');
            if (checkbox) {
              checkbox.checked = !allSelected;
              card.classList.toggle('selected', !allSelected);
            }
          });
        }
        function confirmDeleteSelected() {
          const selectedCheckboxes = document.querySelectorAll('.file-checkbox:checked');
          if (selectedCheckboxes.length === 0) {
            showConfirmModal('请先选择要删除的文件！', null, true);
            return;
          }
          showConfirmModal(
            \`确定要删除选中的 \${selectedCheckboxes.length} 个文件吗？\`, 
            deleteSelectedFiles
          );
        }
        function confirmDeleteCategory() {
          const select = document.getElementById('categoryDeleteSelect');
          if (!select) return;
          const categoryId = select.value;
          if (!categoryId) {
            showConfirmModal('请选择要删除的分类', null, true);
            return;
          }
          const categoryName = select.options[select.selectedIndex].text;
          showConfirmModal(
            \`确定要删除分类 "\${categoryName}" 吗？这将清空所有关联文件的分类！\`, 
            deleteCategory
          );
        }
        function shareFile(url, fileName) {
          console.log('分享文件:', url);
          try {
            const modal = document.createElement('div');
            modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:1000;display:flex;justify-content:center;align-items:center;';
            const content = document.createElement('div');
            content.style.cssText = 'background:white;padding:20px;border-radius:10px;max-width:90%;width:350px;text-align:center;';
            const title = document.createElement('h3');
            title.style.cssText = 'margin-top:0;color:#333;';
            title.textContent = '分享文件';
            const fileNameElem = document.createElement('div');
            fileNameElem.style.cssText = 'margin-bottom:10px;word-break:break-all;font-size:14px;color:#666;';
            fileNameElem.textContent = fileName || getFileName(url);
            const qrContainer = document.createElement('div');
            qrContainer.id = 'qrcode-container';
            qrContainer.style.cssText = 'margin:20px auto;height:200px;width:200px;';
            try {
              const qrcode = new QRCode(qrContainer, {
                text: url,
                width: 200,
                height: 200,
                colorDark: "#000000",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.H
              });
            } catch (qrError) {
              console.error('二维码生成失败:', qrError);
              qrContainer.innerHTML = '<div style="padding:20px;word-break:break-all;border:1px dashed #ccc;">' + url + '</div>';
            }
            const buttons = document.createElement('div');
            buttons.style.cssText = 'display:flex;gap:10px;justify-content:center;margin-top:20px;';
            const copyBtn = document.createElement('button');
            copyBtn.id = 'copy-link-btn';
            copyBtn.style.cssText = 'flex:1;padding:8px 15px;border:none;border-radius:4px;background:#3498db;color:white;cursor:pointer;';
            copyBtn.textContent = '复制';
            copyBtn.onclick = function() {
              navigator.clipboard.writeText(url)
                .then(() => {
                  copyBtn.textContent = '已复制';
                  setTimeout(() => { copyBtn.textContent = '复制'; }, 2000);
                })
                .catch(() => {
                  prompt('请手动复制链接:', url);
                });
            };
            const downloadBtn = document.createElement('a');
            downloadBtn.id = 'download-file-btn';
            downloadBtn.style.cssText = 'flex:1;padding:8px 15px;border:none;border-radius:4px;background:#2ecc71;color:white;cursor:pointer;text-decoration:none;display:inline-block;text-align:center;';
            downloadBtn.textContent = '下载';
            downloadBtn.href = url;
            downloadBtn.setAttribute('download', fileName || getFileName(url));
            const cancelBtn = document.createElement('button');
            cancelBtn.id = 'close-share-btn';
            cancelBtn.style.cssText = 'flex:1;padding:8px 15px;border:none;border-radius:4px;background:#95a5a6;color:white;cursor:pointer;';
            cancelBtn.textContent = '取消';
            cancelBtn.onclick = function() {
              document.body.removeChild(modal);
            };
            buttons.appendChild(copyBtn);
            buttons.appendChild(downloadBtn);
            buttons.appendChild(cancelBtn);
            content.appendChild(title);
            content.appendChild(fileNameElem);
            content.appendChild(qrContainer);
            content.appendChild(buttons);
            modal.appendChild(content);
            modal.addEventListener('click', function(e) {
              if (e.target === modal) {
                document.body.removeChild(modal);
              }
            });
            document.body.appendChild(modal);
          } catch (error) {
            console.error('分享功能出错:', error);
            try {
              navigator.clipboard.writeText(url)
                .then(() => alert('链接已复制: ' + url))
                .catch(() => prompt('请复制链接:', url));
            } catch (e) {
              prompt('请复制链接:', url);
            }
          }
        }
        function closeQrModal() {
          if (qrModal) qrModal.style.display = 'none';
        }
        function copyCurrentShareUrl() {
          if (!currentShareUrl) return;
          navigator.clipboard.writeText(currentShareUrl)
            .then(() => {
              if (qrCopyBtn) {
                qrCopyBtn.textContent = '✓ 已复制';
                setTimeout(() => {
                  qrCopyBtn.textContent = '复制链接';
                }, 2000);
              }
            })
            .catch(() => {
              prompt('请手动复制链接:', currentShareUrl);
            });
        }
        function showConfirmModal(message, callback, alertOnly = false) {
          if (!confirmModal || !confirmModalMessage || !confirmModalConfirm || !confirmModalCancel) {
            alert(message);
            if (callback && !alertOnly) callback();
            return;
          }
          closeConfirmModal();
          confirmModalMessage.textContent = message;
          currentConfirmCallback = callback;
          if (alertOnly) {
            confirmModalConfirm.textContent = '确定';
            confirmModalCancel.style.display = 'none';
          } else {
            confirmModalConfirm.textContent = '确认';
            confirmModalCancel.style.display = 'inline-block';
          }
          confirmModal.classList.add('show');
        }
        function closeConfirmModal() {
          if (confirmModal) confirmModal.classList.remove('show');
        }
        function handleConfirmModalConfirm() {
          if (currentConfirmCallback) {
            currentConfirmCallback();
          }
          closeConfirmModal();
        }
        function handleWindowClick(event) {
          if (confirmModal && event.target === confirmModal) {
            closeConfirmModal();
          }
          if (qrModal && event.target === qrModal) {
            closeQrModal();
          }
          if (editSuffixModal && event.target === editSuffixModal) {
            editSuffixModal.classList.remove('show');
          }
        }
        function showEditSuffixModal(url) {
          console.log('显示修改后缀弹窗:', url, '弹窗元素:', !!editSuffixModal);
          if (!editSuffixModal) {
            console.error('修改后缀弹窗元素不存在');
            alert('修改后缀功能不可用');
            return;
          }
          currentEditUrl = url;
          const urlObj = new URL(url);
          const pathParts = urlObj.pathname.split('/');
          const fileName = pathParts[pathParts.length - 1];
          const fileNameParts = fileName.split('.');
          const extension = fileNameParts.pop(); 
          const currentSuffix = fileNameParts.join('.'); 
          const editSuffixInput = document.getElementById('editSuffixInput');
          if (editSuffixInput) {
            editSuffixInput.value = currentSuffix;
            editSuffixModal.classList.add('show');
          } else {
            console.error('找不到编辑后缀输入框');
          }
        }
        async function deleteFile(url, card) {
          try {
            const urlObj = new URL(url);
            const pathParts = urlObj.pathname.split('/');
            const fileName = pathParts[pathParts.length - 1];
            const response = await fetch('/delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: url, fileId: fileName }) 
            });
            if (!response.ok) {
              const errorData = await response.json();
              throw new Error(errorData.error || errorData.message || '删除失败');
            }
            if (card) {
              card.remove();
            } else {
              const card = document.querySelector(\`[data-url="\${url}"]\`);
              if (card) card.remove();
            }
            showConfirmModal('文件删除成功', null, true);
          } catch (error) {
            showConfirmModal('文件删除失败: ' + error.message, null, true);
          }
        }
        async function deleteSelectedFiles() {
          const checkboxes = document.querySelectorAll('.file-checkbox:checked');
          const urls = Array.from(checkboxes).map(cb => cb.value);
          try {
            const response = await fetch('/delete-multiple', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ urls })
            });
            if (!response.ok) {
              const errorData = await response.json();
              throw new Error(errorData.error || '批量删除失败');
            }
            checkboxes.forEach(cb => {
              const card = cb.closest('.file-card');
              if (card) card.remove();
            });
            showConfirmModal('批量删除成功', null, true);
          } catch (error) {
            showConfirmModal('批量删除失败: ' + error.message, null, true);
          }
        }
        async function deleteCategory() {
          const select = document.getElementById('categoryDeleteSelect');
          if (!select) return;
          const categoryId = select.value;
          try {
            const response = await fetch('/delete-category', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: categoryId })
            });
            const data = await response.json();
            if (data.status === 1) {
              select.remove(select.selectedIndex);
              showConfirmModal(data.msg, () => {
                window.location.reload();
              }, true);
            } else {
              showConfirmModal(data.msg, null, true);
            }
          } catch (error) {
            showConfirmModal('删除分类失败: ' + error.message, null, true);
          }
        }
        async function updateFileSuffix() {
          const editSuffixInput = document.getElementById('editSuffixInput');
          if (!editSuffixInput) return;
          const newSuffix = editSuffixInput.value;
          try {
            const response = await fetch('/update-suffix', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                url: currentEditUrl,
                suffix: newSuffix
              })
            });
            const data = await response.json();
            if (data.status === 1) {
              if (editSuffixModal) editSuffixModal.classList.remove('show');
              const card = document.querySelector('.file-card[data-url="' + currentEditUrl + '"]');
              if (card) {
                card.setAttribute('data-url', data.newUrl);
                const shareBtn = card.querySelector('.btn-share');
                const deleteBtn = card.querySelector('.btn-delete');
                const editBtn = card.querySelector('.btn-edit');
                if (shareBtn) {
                  const fileName = getFileName(data.newUrl);
                  shareBtn.setAttribute('onclick', 'shareFile("' + data.newUrl + '", "' + fileName + '")');
                }
                if (deleteBtn) {
                  const newOnclick = deleteBtn.getAttribute('onclick').replace(currentEditUrl, data.newUrl);
                  deleteBtn.setAttribute('onclick', newOnclick);
                }
                if (editBtn) {
                  editBtn.setAttribute('onclick', 'showEditSuffixModal("' + data.newUrl + '")');
                }
                const fileNameElement = card.querySelector('.file-info div:first-child');
                if (fileNameElement) {
                  const urlObj = new URL(data.newUrl);
                  const fileName = urlObj.pathname.split('/').pop();
                  fileNameElement.textContent = fileName;
                }
                const checkbox = card.querySelector('.file-checkbox');
                if (checkbox) {
                  checkbox.value = data.newUrl;
                }
              }
              currentEditUrl = data.newUrl;
              showConfirmModal(data.msg, null, true);
            } else {
              showConfirmModal(data.msg || '修改后缀失败', null, true);
            }
          } catch (error) {
            showConfirmModal('修改后缀时出错：' + error.message, null, true);
          }
        }
        function getFileName(url) {
          try {
            const urlObj = new URL(url);
            const pathParts = urlObj.pathname.split('/');
            return pathParts[pathParts.length - 1];
          } catch (e) {
            return url.split('/').pop() || url;
          }
        }
      </script>
    </body>
    </html>`;
  }
  async function handleUpdateSuffixRequest(request, config) {
    try {
      const { url, suffix } = await request.json();
      if (!url || !suffix) {
        return new Response(JSON.stringify({
          status: 0,
          msg: '文件链接和后缀不能为空'
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      const originalFileName = getFileName(url);
      let fileRecord = await config.database.prepare('SELECT * FROM files WHERE url = ?')
        .bind(url).first();
      if (!fileRecord) {
        fileRecord = await config.database.prepare('SELECT * FROM files WHERE fileId = ?')
          .bind(originalFileName).first();
        if (!fileRecord) {
          return new Response(JSON.stringify({
            status: 0,
            msg: '未找到对应的文件记录'
          }), { headers: { 'Content-Type': 'application/json' } });
        }
      }
      const fileExt = originalFileName.split('.').pop();
      const newFileName = `${suffix}.${fileExt}`;
      let fileUrl = `https://${config.domain}/${newFileName}`;
      const existingFile = await config.database.prepare('SELECT * FROM files WHERE fileId = ? AND id != ?')
        .bind(newFileName, fileRecord.id).first();
      if (existingFile) {
        return new Response(JSON.stringify({
          status: 0,
          msg: '后缀已存在，无法修改'
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      const existingUrl = await config.database.prepare('SELECT * FROM files WHERE url = ? AND id != ?')
        .bind(fileUrl, fileRecord.id).first();
      if (existingUrl) {
        return new Response(JSON.stringify({
          status: 0,
          msg: '该URL已被使用，请尝试其他后缀'
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      console.log('准备更新文件:', {
        记录ID: fileRecord.id,
        原URL: fileRecord.url,
        原fileId: fileRecord.fileId,
        存储类型: fileRecord.storage_type,
        新文件名: newFileName,
        新URL: fileUrl
      });
      if (fileRecord.storage_type === 'telegram') {
        await config.database.prepare('UPDATE files SET url = ? WHERE id = ?')
          .bind(fileUrl, fileRecord.id).run();
        console.log('Telegram文件更新完成:', {
          id: fileRecord.id,
          新URL: fileUrl
        });
      } 
      else if (config.bucket) {
        try {
          const fileId = fileRecord.fileId || originalFileName;
          console.log('尝试从R2获取文件:', fileId);
          const file = await config.bucket.get(fileId);
          if (file) {
            console.log('R2文件存在，正在复制到新名称:', newFileName);
            const fileData = await file.arrayBuffer();
            await storeFile(fileData, newFileName, file.httpMetadata.contentType, config);
            await deleteFile(fileId, config);
            await config.database.prepare('UPDATE files SET fileId = ?, url = ? WHERE id = ?')
              .bind(newFileName, fileUrl, fileRecord.id).run();
            console.log('R2文件更新完成:', {
              id: fileRecord.id,
              新fileId: newFileName,
              新URL: fileUrl
            });
          } else {
            console.log('R2中未找到文件，只更新URL:', fileId);
            await config.database.prepare('UPDATE files SET url = ? WHERE id = ?')
              .bind(fileUrl, fileRecord.id).run();
          }
        } catch (error) {
          console.error('处理R2文件重命名失败:', error);
          await config.database.prepare('UPDATE files SET url = ? WHERE id = ?')
            .bind(fileUrl, fileRecord.id).run();
        }
      } 
      else {
        console.log('未知存储类型，只更新URL');
        await config.database.prepare('UPDATE files SET url = ? WHERE id = ?')
          .bind(fileUrl, fileRecord.id).run();
      }
      return new Response(JSON.stringify({
        status: 1,
        msg: '后缀修改成功',
        newUrl: fileUrl
      }), { headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
      console.error('更新后缀失败:', error);
      return new Response(JSON.stringify({
        status: 0,
        msg: '更新后缀失败: ' + error.message
      }), { headers: { 'Content-Type': 'application/json' } });
    }
  } 
  function generateNewUrl(url, suffix, config) {
    const fileName = getFileName(url);
    const newFileName = suffix + '.' + fileName.split('.').pop();
    return `https://${config.domain}/${newFileName}`;
  }
  function getFileName(url) {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/');
    return pathParts[pathParts.length - 1];
  }
  function copyToClipboard(text) {
    navigator.clipboard.writeText(text)
      .then(() => {
        showConfirmModal('已复制到剪贴板', null, true);
      })
      .catch(() => {
        showConfirmModal('复制失败，请手动复制', null, true);
      });
  }
  function getExtensionFromMime(mimeType) {
    if (!mimeType) return 'jpg';
    const mimeMap = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'image/bmp': 'bmp',
      'image/avif': 'avif',
      'image/tiff': 'tiff',
      'image/x-icon': 'ico',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/ogg': 'ogv',
      'video/x-msvideo': 'avi',
      'video/quicktime': 'mov',
      'video/x-ms-wmv': 'wmv',
      'video/x-flv': 'flv',
      'video/x-matroska': 'mkv',
      'video/x-m4v': 'm4v',
      'video/mp2t': 'ts',
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/ogg': 'ogg',
      'audio/wav': 'wav',
      'audio/mp4': 'm4a',
      'audio/aac': 'aac',
      'audio/flac': 'flac',
      'audio/x-ms-wma': 'wma',
      'application/pdf': 'pdf',
      'application/msword': 'doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/vnd.ms-excel': 'xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'application/vnd.ms-powerpoint': 'ppt',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
      'application/rtf': 'rtf',
      'application/zip': 'zip',
      'application/x-rar-compressed': 'rar',
      'application/x-7z-compressed': '7z',
      'application/x-tar': 'tar',
      'application/gzip': 'gz',
      'text/plain': 'txt',
      'text/markdown': 'md',
      'text/csv': 'csv',
      'text/html': 'html',
      'text/css': 'css',
      'text/javascript': 'js',
      'application/javascript': 'js',
      'application/json': 'json',
      'application/xml': 'xml',
      'font/ttf': 'ttf',
      'font/otf': 'otf',
      'font/woff': 'woff',
      'font/woff2': 'woff2',
      'application/vnd.ms-fontobject': 'eot',
      'application/octet-stream': 'bin',
      'application/x-shockwave-flash': 'swf'
    };
    return mimeMap[mimeType] || 'bin';
  }
  async function uploadToR2(arrayBuffer, fileName, mimeType, config) {
    try {
      return await storeFile(arrayBuffer, fileName, mimeType, config);
    } catch (error) {
      console.error('上传到R2失败:', error);
      throw new Error(`上传到存储服务失败: ${error.message}`);
    }
  }
  async function storeFile(arrayBuffer, fileName, mimeType, config) {
    if (config.bucket) {
      try {
        await config.bucket.put(fileName, arrayBuffer, {
          httpMetadata: { contentType: mimeType || 'application/octet-stream' }
        });
        return `https://${config.domain}/${fileName}`;
      } catch (error) {
        console.error(`R2存储失败: ${error.message}`);
        return await storeFileInTelegram(arrayBuffer, fileName, mimeType, config);
      }
    } else {
      return await storeFileInTelegram(arrayBuffer, fileName, mimeType, config);
    }
  }
  async function storeFileInTelegram(arrayBuffer, fileName, mimeType, config) {
    if (!config.tgBotToken || !config.tgStorageChatId) {
      throw new Error('未配置Telegram存储参数 (TG_BOT_TOKEN 和 TG_STORAGE_CHAT_ID)');
    }
    const formData = new FormData();
    const blob = new Blob([arrayBuffer], { type: mimeType || 'application/octet-stream' });
    formData.append('document', blob, fileName);
    const response = await fetch(`https://api.telegram.org/bot${config.tgBotToken}/sendDocument?chat_id=${config.tgStorageChatId}`, {
      method: 'POST',
      body: formData
    });
    const result = await response.json();
    if (result.ok) {
      const fileId = result.result.document.file_id;
      const fileUrl = await getTelegramFileUrl(fileId, config.tgBotToken, config);
      return fileUrl;
    } else {
      throw new Error('Telegram存储失败: ' + JSON.stringify(result));
    }
  }
  async function getFile(fileId, config) {
    if (config.bucket) {
      try {
        return await config.bucket.get(fileId);
      } catch (error) {
        console.error('R2获取文件失败:', error);
        return null;
      }
    }
    return null;
  }
  async function deleteFile(fileId, config) {
    if (config.bucket) {
      try {
        await config.bucket.delete(fileId);
        return true;
      } catch (error) {
        console.error('R2删除文件失败:', error);
        return false;
      }
    }
    return true; 
  }
  async function fetchNotification() {
    try {
      const response = await fetch('https://raw.githubusercontent.com/iawooo/ctt/refs/heads/main/CFTeleTrans/notification.md');
      if (!response.ok) {
        return null;
      }
      return await response.text();
    } catch (error) {
      return null;
    }
  }
  function copyShareUrl(url, fileName) {
    console.log('复制分享链接:', url);
    try {
      navigator.clipboard.writeText(url)
        .then(() => {
          alert('链接已复制到剪贴板: ' + url);
        })
        .catch((err) => {
          console.error('复制失败:', err);
          prompt('请手动复制以下链接:', url);
        });
    } catch (error) {
      console.error('复制出错:', error);
      prompt('请手动复制以下链接:', url);
    }
  }
  try {
    document.addEventListener('DOMContentLoaded', function() {
      try {
        console.log('DOM加载完成，初始化页面元素引用');
        window.editSuffixModal = document.getElementById('editSuffixModal');
        if (window.editSuffixModal) {
          console.log('成功获取修改后缀弹窗元素');
        } else {
          console.error('无法获取修改后缀弹窗元素');
        }
        window.currentEditUrl = '';
        window.showEditSuffixModal = showEditSuffixModal;
      } catch (error) {
        console.error('初始化页面元素引用时出错:', error);
      }
    });
  } catch (error) {
    console.error('添加DOMContentLoaded事件监听器失败:', error);
  }
    
