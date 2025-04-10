// 数据库初始化函数
async function initDatabase(config) {
  try {
    // 测试数据库连接
    await config.database.prepare("SELECT 1").run();
    console.log("数据库连接成功");
  } catch (error) {
    console.error(`数据库连接失败: ${error.message}`);
    throw error;
  }

  // 创建必要的表结构
  try {
    // 创建分类表
    await config.database.prepare(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      )
    `).run();
    console.log("分类表检查完成");

    // 创建用户设置表
    await config.database.prepare(`
      CREATE TABLE IF NOT EXISTS user_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL UNIQUE,
        storage_type TEXT DEFAULT 'r2',
        category_id INTEGER,
        custom_suffix TEXT,
        waiting_for TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    console.log("用户设置表检查完成");

    // 创建文件表
    await config.database.prepare(`
      CREATE TABLE IF NOT EXISTS files (
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
    console.log("文件表检查完成");

    // 检查并添加缺失的列
    await checkAndAddMissingColumns(config);

    // 初始化默认分类
    const defaultCategory = await config.database.prepare('SELECT id FROM categories WHERE name = ?').bind('默认分类').first();
    if (!defaultCategory) {
      const time = Date.now();
      await config.database.prepare('INSERT INTO categories (name, created_at) VALUES (?, ?)')
        .bind('默认分类', time).run();
      console.log("默认分类已创建");
    } else {
      console.log("默认分类已存在");
    }
    
    // 验证数据库结构完整性
    await validateDatabaseStructure(config);
    
    console.log("数据库初始化完成");
  } catch (error) {
    console.error(`数据库初始化过程中发生错误: ${error.message}`);
    throw error;
  }
}

// 验证数据库结构完整性
async function validateDatabaseStructure(config) {
  console.log("正在验证数据库结构...");
  
  try {
    // 检查categories表结构
    const categoriesColumns = await config.database.prepare(`PRAGMA table_info(categories)`).all();
    const hasCategoriesRequiredColumns = categoriesColumns.results.some(col => col.name === 'id') && 
                                         categoriesColumns.results.some(col => col.name === 'name') &&
                                         categoriesColumns.results.some(col => col.name === 'created_at');
    
    if (!hasCategoriesRequiredColumns) {
      console.warn("分类表结构不完整，尝试重建...");
      await recreateCategoriesTable(config);
    }
    
    // 检查user_settings表结构
    const userSettingsColumns = await config.database.prepare(`PRAGMA table_info(user_settings)`).all();
    const hasUserSettingsRequiredColumns = userSettingsColumns.results.some(col => col.name === 'chat_id') && 
                                           userSettingsColumns.results.some(col => col.name === 'storage_type') &&
                                           userSettingsColumns.results.some(col => col.name === 'category_id') &&
                                           userSettingsColumns.results.some(col => col.name === 'custom_suffix') &&
                                           userSettingsColumns.results.some(col => col.name === 'waiting_for');
    
    if (!hasUserSettingsRequiredColumns) {
      console.warn("用户设置表结构不完整，尝试重建...");
      await recreateUserSettingsTable(config);
    }
    
    // 检查files表结构
    const filesColumns = await config.database.prepare(`PRAGMA table_info(files)`).all();
    const hasFilesRequiredColumns = filesColumns.results.some(col => col.name === 'url') && 
                                    filesColumns.results.some(col => col.name === 'fileId') &&
                                    filesColumns.results.some(col => col.name === 'message_id') &&
                                    filesColumns.results.some(col => col.name === 'created_at') &&
                                    filesColumns.results.some(col => col.name === 'storage_type') &&
                                    filesColumns.results.some(col => col.name === 'category_id');
    
    if (!hasFilesRequiredColumns) {
      console.warn("文件表结构不完整，尝试重建...");
      await recreateFilesTable(config);
    }
    
    console.log("数据库结构验证完成");
  } catch (error) {
    console.error(`数据库结构验证失败: ${error.message}`);
    // 即使验证失败，我们也不抛出错误，让应用继续运行
  }
}

// 重建分类表
async function recreateCategoriesTable(config) {
  try {
    // 备份现有数据
    const existingData = await config.database.prepare('SELECT * FROM categories').all();
    
    // 删除并重建表
    await config.database.prepare('DROP TABLE IF EXISTS categories').run();
    await config.database.prepare(`
      CREATE TABLE categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      )
    `).run();
    
    // 恢复数据
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

// 重建用户设置表
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

// 重建文件表
async function recreateFilesTable(config) {
  console.log('开始重建文件表...');
  try {
    // 备份现有数据
    console.log('备份现有数据...');
    const existingData = await config.database.prepare('SELECT * FROM files').all();
    
    // 删除表
    console.log('删除现有表...');
    await config.database.prepare('DROP TABLE IF EXISTS files').run();
    
    // 重新创建表
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
    
    // 恢复数据
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
    // 检查文件表是否有custom_suffix字段
    await ensureColumnExists(config, 'files', 'custom_suffix', 'TEXT');
    // 检查文件表是否有chat_id字段
    await ensureColumnExists(config, 'files', 'chat_id', 'TEXT');
    
    // 检查用户设置表是否有custom_suffix字段
    await ensureColumnExists(config, 'user_settings', 'custom_suffix', 'TEXT');
    
    // 检查用户设置表是否有waiting_for字段
    await ensureColumnExists(config, 'user_settings', 'waiting_for', 'TEXT');
    
    // 检查用户设置表是否有current_category_id列
    await ensureColumnExists(config, 'user_settings', 'current_category_id', 'INTEGER');
    
    return true;
  } catch (error) {
    console.error('检查并添加缺失列失败:', error);
    return false;
  }
}

async function ensureColumnExists(config, tableName, columnName, columnType) {
  try {
    // 先检查列是否存在
    const tableInfo = await config.database.prepare(`PRAGMA table_info(${tableName})`).all();
    const columnExists = tableInfo.results.some(col => col.name === columnName);
    
    if (columnExists) {
      console.log(`列 ${columnName} 已存在于表 ${tableName} 中`);
      return;
    }
    
    // 列不存在，添加它
    console.log(`向表 ${tableName} 添加列 ${columnName}...`);
    await config.database.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`).run();
    console.log(`列 ${columnName} 已成功添加到表 ${tableName}`);
  } catch (error) {
    // 特殊处理"列已存在"的错误
    if (error.message.includes('duplicate column name') || error.message.includes('already exists')) {
      console.log(`列 ${columnName} 已存在于表 ${tableName} 中(通过错误处理确认)`);
      return;
    }
    
    console.error(`检查表 ${tableName} 中的列 ${columnName} 时发生错误: ${error.message}`);
    throw error;
  }
}

async function setWebhook(webhookUrl, botToken) {
  const maxRetries = 3;
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/setWebhook?url=${webhookUrl}`
      );
      const result = await response.json();
      
      if (!result.ok) {
        if (result.error_code === 429) {
          // 获取重试等待时间
          const retryAfter = result.parameters?.retry_after || 1;
          console.log(`Rate limited, waiting ${retryAfter} seconds before retry...`);
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          retryCount++;
          continue;
        }
        console.error(`Failed to set webhook: ${JSON.stringify(result)}`);
        return false;
      }
      
      console.log(`Webhook set successfully: ${webhookUrl}`);
      return true;
    } catch (error) {
      console.error(`Error setting webhook: ${error.message}`);
      retryCount++;
      if (retryCount < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 等待1秒后重试
      }
    }
  }
  
  console.error('Failed to set webhook after maximum retries');
  return false;
}

export default {
  async fetch(request, env) {
    const config = {
      domain: env.DOMAIN,
      database: env.DATABASE,
      username: env.USERNAME,
      password: env.PASSWORD,
      enableAuth: env.ENABLE_AUTH === 'true',
      tgBotToken: env.TG_BOT_TOKEN,
      tgChatId: env.TG_CHAT_ID.split(","),
      tgStorageChatId: env.TG_STORAGE_CHAT_ID || env.TG_CHAT_ID,
      cookie: Number(env.COOKIE) || 7,
      maxSizeMB: Number(env.MAX_SIZE_MB) || 20,
      bucket: env.BUCKET
    };

    try {
      await initDatabase(config);
    } catch (error) {
      console.error(`Database initialization failed: ${error.message}`);
      return new Response('Database initialization failed', { status: 500 });
    }

    const webhookUrl = `https://${config.domain}/webhook`;
    const webhookSet = await setWebhook(webhookUrl, config.tgBotToken);
    if (!webhookSet) {
      console.error('Webhook setup failed');
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
    
    // 如果收到的是消息
    if (update.message) {
      const chatId = update.message.chat.id.toString();
      
      // 检查用户是否有设置记录，没有则创建
      let userSetting = await config.database.prepare('SELECT * FROM user_settings WHERE chat_id = ?').bind(chatId).first();
      if (!userSetting) {
        await config.database.prepare('INSERT INTO user_settings (chat_id, storage_type) VALUES (?, ?)').bind(chatId, 'r2').run();
        userSetting = { chat_id: chatId, storage_type: 'r2' };
      }
      
      // 检查用户是否在等待输入
      if (userSetting.waiting_for === 'custom_suffix' && update.message.text) {
        // 用户正在设置自定义后缀
        const suffix = update.message.text.trim();
        
        // 更新用户的自定义后缀设置
        await config.database.prepare('UPDATE user_settings SET custom_suffix = ?, waiting_for = NULL WHERE chat_id = ?').bind(suffix, chatId).run();
        
        // 发送确认消息
        await sendMessage(chatId, `✅ 自定义后缀已设置为: ${suffix}\n\n今后上传的文件将命名为: ${suffix}.jpg(或其他扩展名)`, config.tgBotToken);
        
        // 更新面板
        userSetting.custom_suffix = suffix;
        userSetting.waiting_for = null;
        await sendPanel(chatId, userSetting, config);
        return new Response('OK');
      }
      
      // 处理命令
      if (update.message.text === '/start') {
        await sendPanel(chatId, userSetting, config);
      } 
      // 处理文件上传
      else if (update.message.photo || update.message.document) {
        const file = update.message.document || update.message.photo?.slice(-1)[0];
        await handleMediaUpload(chatId, file, !!update.message.document, config, userSetting);
      }
    } 
    // 处理回调查询（按钮点击）
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
  // 获取当前分类
  let categoryName = '默认';
  if (userSetting && userSetting.category_id) {
    const category = await config.database.prepare('SELECT name FROM categories WHERE id = ?').bind(userSetting.category_id).first();
    if (category) {
      categoryName = category.name;
    }
  }
  
  // 获取当前设置的后缀
  let currentSuffix = '自动生成';
  if (userSetting && userSetting.custom_suffix) {
    currentSuffix = userSetting.custom_suffix;
  }
  
  const message = `📷 文件上传助手 3.0

📂 系统状态
━━━━━━━━━━
🔸 存储模式: ${userSetting?.storage_type === 'r2' ? '☁️ R2云存储' : '📡 Telegram存储'}
🔸 当前分类: ${categoryName}
🔸 文件后缀: ${currentSuffix}

💡 使用说明
━━━━━━━━━━
1️⃣ 直接发送文件即可上传
2️⃣ 支持图片、视频、文档等
3️⃣ 上传后自动生成直链和二维码`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: "☁️ R2存储", callback_data: "r2" },
        { text: "📡 TG存储", callback_data: "telegram" }
      ],
      [
        { text: "📁 选择分类", callback_data: "set_category" },
        { text: "➕ 新建分类", callback_data: "create_category" }
      ],
      [
        { text: "🏷 设置后缀", callback_data: "set_suffix" },
        { text: "📊 使用统计", callback_data: "stats" }
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
      parse_mode: 'HTML'
    })
  });
}

async function handleCallbackQuery(update, config, userSetting) {
  const cbData = update.callback_query.data;
  const chatId = update.callback_query.from.id;
  
  if (cbData === 'r2' || cbData === 'telegram') {
    // 更新用户存储类型
    await config.database.prepare('UPDATE user_settings SET storage_type = ? WHERE chat_id = ?').bind(cbData, chatId).run();
    await sendMessage(chatId, `✅ 存储类型已切换为: ${cbData === 'r2' ? 'R2云存储' : 'Telegram存储'}`, config.tgBotToken);
    await sendPanel(chatId, { ...userSetting, storage_type: cbData }, config);
  } else if (cbData === 'set_category') {
    // 显示分类列表
    const categories = await config.database.prepare('SELECT * FROM categories').all();
    let keyboard = [];
    const results = categories.results || [];
    
    for (let i = 0; i < results.length; i += 2) {
      let row = [{ text: `📁 ${results[i].name}`, callback_data: `category_${results[i].id}` }];
      if (results[i + 1]) {
        row.push({ text: `📁 ${results[i + 1].name}`, callback_data: `category_${results[i + 1].id}` });
      }
      keyboard.push(row);
    }
    
    keyboard.push([{ text: "↩️ 返回主菜单", callback_data: "back_to_panel" }]);
    
    await fetch(`https://api.telegram.org/bot${config.tgBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: "🗂 请选择文件分类:",
        reply_markup: { inline_keyboard: keyboard }
      })
    });
  } else if (cbData === 'create_category') {
    await sendMessage(chatId, "📝 请回复此消息，输入新分类名称", config.tgBotToken);
    await config.database.prepare('UPDATE user_settings SET waiting_for = ? WHERE chat_id = ?').bind('new_category', chatId).run();
  } else if (cbData.startsWith('category_')) {
    const categoryId = parseInt(cbData.split('_')[1]);
    await config.database.prepare('UPDATE user_settings SET category_id = ? WHERE chat_id = ?').bind(categoryId, chatId).run();
    
    const category = await config.database.prepare('SELECT name FROM categories WHERE id = ?').bind(categoryId).first();
    await sendMessage(chatId, `✅ 已切换到分类: ${category?.name || '未知分类'}`, config.tgBotToken);
    
    await sendPanel(chatId, { ...userSetting, category_id: categoryId }, config);
  } else if (cbData === 'back_to_panel') {
    await sendPanel(chatId, userSetting, config);
  } else if (cbData === 'set_suffix') {
    await sendMessage(chatId, "🏷 请回复此消息，输入文件后缀\n\n示例：my_file\n上传的文件将被命名为：my_file.jpg", config.tgBotToken);
    await config.database.prepare('UPDATE user_settings SET waiting_for = ? WHERE chat_id = ?').bind('custom_suffix', chatId).run();
  } else if (cbData === 'stats') {
    // 获取用户统计信息
    const stats = await config.database.prepare(`
      SELECT COUNT(*) as total_files, 
             SUM(file_size) as total_size,
             COUNT(DISTINCT category_id) as total_categories
      FROM files WHERE chat_id = ?
    `).bind(chatId).first();
    
    const statsMessage = `📊 您的使用统计
━━━━━━━━━━
📦 总文件数: ${stats.total_files || 0}
💾 总存储量: ${formatSize(stats.total_size || 0)}
📁 使用分类: ${stats.total_categories || 0}个`;
    
    await sendMessage(chatId, statsMessage, config.tgBotToken);
  }
}

async function handleMediaUpload(chatId, file, isDocument, config, userSetting) {
  try {
    let fileUrl = await getTelegramFileUrl(file.file_id, config.tgBotToken);
    const response = await fetch(fileUrl);
    if (!response.ok) throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
    const contentLength = response.headers.get('content-length');
    
    // 检查文件大小
    if (contentLength && parseInt(contentLength) > config.maxSizeMB * 1024 * 1024) {
      await sendMessage(chatId, `❌ 文件超过${config.maxSizeMB}MB限制`, config.tgBotToken);
      return;
    }
    
    const arrayBuffer = await response.arrayBuffer();
    
    // 获取文件名和后缀
    let fileName;
    if (isDocument && file.file_name) {
      fileName = file.file_name;
    } else {
      // 生成随机文件名
      const timestamp = Date.now();
      const ext = getExtensionFromMime(file.mime_type);
      fileName = `${timestamp}.${ext}`;
    }
    
    // 获取文件扩展名和文件名（不含扩展名）
    const lastDotIndex = fileName.lastIndexOf('.');
    const fileExt = lastDotIndex >= 0 ? fileName.slice(lastDotIndex + 1) : '';
    const fileNameWithoutExt = lastDotIndex >= 0 ? fileName.slice(0, lastDotIndex) : fileName;
    
    // 检查用户是否有自定义后缀设置
    let customSuffix = null;
    if (userSetting && userSetting.custom_suffix) {
      customSuffix = userSetting.custom_suffix;
      // 如果设置了自定义后缀，使用它替换文件名
      if (customSuffix) {
        fileName = `${customSuffix}.${fileExt}`;
      }
    }
    
    // 上传到对象存储
    const r2_url = await uploadToR2(arrayBuffer, fileName, file.mime_type, config);
    
    // 获取当前分类ID，确保有默认值
    let categoryId = null;
    if (userSetting && userSetting.current_category_id) {
      categoryId = userSetting.current_category_id;
    }

    // 写入数据库
    const stmt = await config.database.prepare(`
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
        custom_suffix,
        storage_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const timestamp = Math.floor(Date.now() / 1000); // 当前时间戳（秒）
    
    await stmt.bind(
      r2_url,
      fileName,
      0, // 如果是r2存储，message_id设为0
      timestamp,
      fileName,
      arrayBuffer.byteLength,
      file.mime_type || 'application/octet-stream',
      chatId,
      categoryId,
      customSuffix,
      config.bucket ? 'r2' : 'telegram'
    ).run();
    
    // 发送消息给用户，包含二维码
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(r2_url)}`;
    
    await fetch(`https://api.telegram.org/bot${config.tgBotToken}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        photo: qrCodeUrl,
        caption: `✅ 文件上传成功\n\n📎 文件直链：\n${r2_url}\n\n🔍 扫描上方二维码快速访问`,
        parse_mode: 'HTML'
      })
    });
  } catch (error) {
    console.error("Error handling media upload:", error);
    await sendMessage(chatId, `❌ 上传失败: ${error.message}`, config.tgBotToken);
  }
}

async function getTelegramFileUrl(fileId, botToken) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
  const data = await response.json();
  if (!data.ok) throw new Error('获取文件路径失败');
  return `https://api.telegram.org/file/bot${botToken}/${data.result.file_path}`;
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
      expirationDate.setDate(expirationDate.getDate() + config.cookie);
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

    const category = await config.database.prepare('SELECT name FROM categories WHERE id = ?').bind(id).first();
    if (!category) {
      return new Response(JSON.stringify({ status: 0, msg: "分类不存在" }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    await config.database.prepare('UPDATE files SET category_id = NULL WHERE category_id = ?').bind(id).run();
    await config.database.prepare('UPDATE user_settings SET current_category_id = NULL WHERE current_category_id = ?').bind(id).run();
    await config.database.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();

    return new Response(JSON.stringify({ status: 1, msg: `分类 "${category.name}" 删除成功` }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
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
    const defaultCategory = await config.database.prepare('SELECT id FROM categories WHERE name = ?').bind('默认分类').first();
    const finalCategoryId = categoryId || defaultCategory.id;
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
      return new Response(JSON.stringify({ error: '无效的URL列表' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    for (const url of urls) {
      const file = await config.database.prepare(
        'SELECT fileId, message_id, storage_type FROM files WHERE url = ?'
      ).bind(url).first();
      if (file) {
        if (file.storage_type === 'telegram') {
          try {
            await fetch(
              `https://api.telegram.org/bot${config.tgBotToken}/deleteMessage?chat_id=${config.tgStorageChatId}&message_id=${file.message_id}`
            );
          } catch (error) {
            console.error(`Failed to delete Telegram message for ${url}: ${error.message}`);
          }
        } else if (file.storage_type === 'r2') {
          await config.bucket.delete(file.fileId);
        }
        await config.database.prepare('DELETE FROM files WHERE url = ?').bind(url).run();
      }
    }

    return new Response(
      JSON.stringify({ success: true, message: '批量删除成功' }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error(`[Delete Multiple Error] ${error.message}`);
    return new Response(
      JSON.stringify({ error: error.message }),
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
            <div>上传时间: ${new Date(file.created_at).toLocaleString()}</div>
            <div>分类: ${file.category_name || '无分类'}</div>
          </div>
          <div class="file-actions">
            <button class="btn btn-copy" onclick="copyToClipboard('${url}')">复制链接</button>
            <a class="btn btn-down" href="${url}" target="_blank">查看</a>
            <button class="btn btn-share" onclick="shareFile('${url}')">分享</button>
            <button class="btn btn-delete" onclick="showConfirmModal('确定要删除这个文件吗？', () => deleteFile('${url}'))">删除</button>
            <button class="btn btn-edit" onclick="showEditSuffixModal('${url}')">修改后缀</button>
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
  const url = new URL(request.url);
  const pathname = url.pathname.substring(1);
  
  try {
    // 首先查询数据库
    const file = await config.database.prepare('SELECT * FROM files WHERE fileId = ? OR url LIKE ?')
      .bind(pathname, `%${pathname}`).first();

    if (file) {
      // 如果在数据库中找到记录
      const downloadHeader = request.headers.get('download') === 'true'
        ? { 'Content-Disposition': `attachment; filename="${file.fileName}"` }
        : {};
      
      // 检查是否存在缓存的文件响应
      let fileResponse = null;
      
      // 尝试从R2存储获取文件
      fileResponse = await getFile(file.fileId, config);
      
      if (fileResponse) {
        // 从R2存储返回文件
        return new Response(await fileResponse.arrayBuffer(), {
          headers: {
            'Content-Type': fileResponse.httpMetadata.contentType,
            'Cache-Control': 'public, max-age=31536000',
            ...downloadHeader
          }
        });
      } else {
        // 如果文件不在R2存储中，可能是存储在Telegram或其他地方
        // 重定向到文件URL
        return Response.redirect(file.url, 302);
      }
    }
    
    // 如果数据库中没有找到，尝试直接从R2获取
    try {
      const fileResponse = await getFile(pathname, config);
      if (fileResponse) {
        const contentType = fileResponse.httpMetadata.contentType || 'application/octet-stream';
        return new Response(await fileResponse.arrayBuffer(), {
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=31536000'
          }
        });
      }
    } catch (error) {
      console.error('直接从R2获取文件失败:', error);
    }
    
    // 什么都没找到，返回404
    return new Response('文件不存在', { status: 404 });
  } catch (error) {
    console.error('处理文件请求时出错:', error);
    return new Response('服务器错误: ' + error.message, { status: 500 });
  }
}

async function handleDeleteRequest(request, config) {
  if (config.enableAuth && !authenticate(request, config)) {
    return Response.redirect(`${new URL(request.url).origin}/`, 302);
  }

  try {
    const { id } = await request.json();
    if (!id) {
      return new Response(JSON.stringify({
        status: 0,
        message: '缺少文件ID'
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 查询文件信息
    const file = await config.database.prepare('SELECT * FROM files WHERE id = ?').bind(id).first();
    if (!file) {
      return new Response(JSON.stringify({
        status: 0,
        message: '文件不存在'
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 尝试从存储中删除文件
    await deleteFile(file.fileId, config);

    // 从数据库中删除文件记录
    await config.database.prepare('DELETE FROM files WHERE id = ?').bind(id).run();

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
    icon: 'image/x-icon',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    zip: 'application/zip',
    rar: 'application/x-rar-compressed',
    json: 'application/json',
    xml: 'application/xml',
    ini: 'text/plain',
    js: 'application/javascript',
    yml: 'application/yaml',
    yaml: 'application/yaml',
    py: 'text/x-python',
    sh: 'application/x-sh'
  };
  return types[ext] || 'application/octet-stream';
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

async function sendMessage(chatId, text, botToken, replyToMessageId = null) {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        reply_to_message_id: replyToMessageId
      })
    });
  } catch (error) {
    console.error(`Error sending message: ${error.message}`);
  }
}

function generateLoginPage() {
  return `<!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <link rel="shortcut icon" href="https://pan.811520.xyz/2025-02/1739241502-tgfile-favicon.ico" type="image/x-icon">
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
      
      /* 美化弹窗样式 */
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
    <link rel="shortcut icon" href="https://pan.811520.xyz/2025-02/1739241502-tgfile-favicon.ico" type="image/x-icon">
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
      
      /* 美化弹窗样式 */
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
            <span>© 2025 Copyright by <a href="https://github.com/yutian81/CF-tgfile" target="_blank">yutian81's GitHub</a> | <a href="https://blog.811520.xyz/" target="_blank">青云志</a></span>
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

      // 显示确认弹窗
      function showConfirmModal(message, callback, alertOnly = false) {
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

      // 关闭确认弹窗
      function closeConfirmModal() {
        confirmModal.classList.remove('show');
      }

      // 确认按钮事件
      confirmModalConfirm.addEventListener('click', () => {
        if (currentConfirmCallback) {
          currentConfirmCallback();
        }
        closeConfirmModal();
      });

      // 取消按钮事件
      confirmModalCancel.addEventListener('click', closeConfirmModal);

      // 点击弹窗外部关闭弹窗
      window.addEventListener('click', (event) => {
        if (event.target === confirmModal) {
          closeConfirmModal();
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
    <link rel="shortcut icon" href="https://pan.811520.xyz/2025-02/1739241502-tgfile-favicon.ico" type="image/x-icon">
    <meta name="description" content="Telegram文件存储与分享平台">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>文件管理</title>
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
      }
      .btn-copy {
        background: #3498db;
        color: white;
      }
      .btn-down {
        background: #2ecc71;
        color: white;
        text-decoration: none;
      }
      .btn-delete {
        background: #e74c3c;
        color: white;
      }
      .btn-edit {
        background: #f39c12;
        color: white;
      }
      .btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0,0,0,0.15);
      }
      .btn-copy:hover {
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
      
      /* 美化弹窗样式 */
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
      
      /* 二维码弹窗样式 */
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
        margin-bottom: 1rem;
      }
      #qrcode {
        margin: 1.5rem auto;
      }
      .qr-buttons {
        display: flex;
        gap: 1rem;
        justify-content: center;
        margin-top: 1.5rem;
      }
      .qr-copy, .qr-close {
        padding: 0.8rem 1.8rem;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.3s ease;
        box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        font-size: 0.95rem;
        font-weight: 500;
      }
      .qr-copy {
        background: #3498db;
        color: white;
      }
      .qr-close {
        background: #95a5a6;
        color: white;
      }
      .qr-copy:hover, .qr-close:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0,0,0,0.15);
      }
      .qr-copy:hover {
        background: #2980b9;
      }
      .qr-close:hover {
        background: #7f8c8d;
      }
      
      /* 修改后缀弹窗样式 */
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
          <a href="/upload" class="backup">返回上传</a>
          <select id="categoryFilter" class="category-filter">
            <option value="">所有分类</option>
            ${categoryOptions}
          </select>
          <input type="text" class="search" placeholder="搜索文件..." id="searchInput">
        </div>
      </div>
      
      <div class="action-bar">
        <div class="action-bar-left">
          <button class="action-button select-all-btn" id="selectAllBtn">全选</button>
          <button class="action-button delete-files-btn" id="deleteFilesBtn">删除所选文件</button>
        </div>
        <div class="action-bar-right">
          <h3>分类管理</h3>
          <select id="categoryDeleteSelect">
            <option value="">选择要删除的分类</option>
            ${categoryOptions}
          </select>
          <button class="action-button delete-category-btn" id="deleteCategoryBtn">删除分类</button>
        </div>
      </div>
      
      <div class="grid" id="fileGrid">
        ${fileCards}
      </div>
      
      <!-- 通用确认弹窗 -->
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
      
      <!-- 二维码弹窗 -->
      <div id="qrModal" class="modal">
        <div class="qr-content">
          <h3 class="qr-title">分享文件</h3>
          <div id="qrcode"></div>
          <div class="qr-buttons">
            <button class="qr-copy" id="qrCopyBtn">复制链接</button>
            <button class="qr-close" id="qrCloseBtn">关闭</button>
          </div>
        </div>
      </div>
      
      <!-- 修改后缀弹窗 -->
      <div id="editSuffixModal" class="modal">
        <div class="modal-content">
          <h3 class="modal-title">修改文件后缀</h3>
          <input type="text" id="editSuffixInput" placeholder="输入新的文件后缀">
          <div class="modal-buttons">
            <button class="modal-button modal-confirm" id="editSuffixConfirm">确认</button>
            <button class="modal-button modal-cancel" id="editSuffixCancel">取消</button>
          </div>
        </div>
      </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/qrcodejs/qrcode.min.js"></script>
    <script>
      // 设置背景图片
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

      // 搜索和筛选功能
      const searchInput = document.getElementById('searchInput');
      const categoryFilter = document.getElementById('categoryFilter');
      const fileGrid = document.getElementById('fileGrid');
      const fileCards = Array.from(fileGrid.children);
      const selectAllBtn = document.getElementById('selectAllBtn');
      const deleteFilesBtn = document.getElementById('deleteFilesBtn');
      const deleteCategoryBtn = document.getElementById('deleteCategoryBtn');
      const confirmModal = document.getElementById('confirmModal');
      const confirmModalMessage = document.getElementById('confirmModalMessage');
      const confirmModalConfirm = document.getElementById('confirmModalConfirm');
      const confirmModalCancel = document.getElementById('confirmModalCancel');
      const qrModal = document.getElementById('qrModal');
      const qrCopyBtn = document.getElementById('qrCopyBtn');
      const qrCloseBtn = document.getElementById('qrCloseBtn');
      const editSuffixModal = document.getElementById('editSuffixModal');
      const editSuffixInput = document.getElementById('editSuffixInput');
      const editSuffixConfirm = document.getElementById('editSuffixConfirm');
      const editSuffixCancel = document.getElementById('editSuffixCancel');
      
      let currentShareUrl = '';
      let currentConfirmCallback = null;

      searchInput.addEventListener('input', filterFiles);
      categoryFilter.addEventListener('change', filterFiles);

      // 初始化文件点击事件
      fileCards.forEach(card => {
        const checkbox = card.querySelector('.file-checkbox');
        
        // 点击卡片区域就可以选中/取消选中文件
        card.addEventListener('click', (e) => {
          // 如果点击在按钮上则不触发选择
          if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A' || 
              e.target.closest('.btn') || e.target.closest('.file-actions')) {
            return;
          }
          
          // 切换复选框状态
          checkbox.checked = !checkbox.checked;
          // 更新卡片选中状态
          card.classList.toggle('selected', checkbox.checked);
          e.preventDefault(); // 防止其他点击事件
        });
        
        // 复选框状态变化时更新卡片选中状态
        checkbox.addEventListener('change', () => {
          card.classList.toggle('selected', checkbox.checked);
        });
      });

      function filterFiles() {
        const searchTerm = searchInput.value.toLowerCase();
        const selectedCategory = categoryFilter.value;

        fileCards.forEach(card => {
          const fileName = card.querySelector('.file-info div:first-child').textContent.toLowerCase();
          const categoryId = card.getAttribute('data-category-id') || '';

          const matchesSearch = fileName.includes(searchTerm);
          const matchesCategory = selectedCategory === '' || categoryId === selectedCategory;

          card.style.display = matchesSearch && matchesCategory ? '' : 'none';
        });
      }

      // 全选/取消全选功能
      selectAllBtn.addEventListener('click', () => {
        const visibleCards = fileCards.filter(card => card.style.display !== 'none');
        const allSelected = visibleCards.every(card => card.querySelector('.file-checkbox').checked);
        
        visibleCards.forEach(card => {
          const checkbox = card.querySelector('.file-checkbox');
          checkbox.checked = !allSelected;
          card.classList.toggle('selected', !allSelected);
        });
      });

      // 删除选中的文件
      deleteFilesBtn.addEventListener('click', () => {
        const selectedCheckboxes = document.querySelectorAll('.file-checkbox:checked');
        if (selectedCheckboxes.length === 0) {
          showConfirmModal('请先选择要删除的文件！', null, true);
          return;
        }
        
        showConfirmModal(
          \`确定要删除选中的 \${selectedCheckboxes.length} 个文件吗？\`, 
          deleteSelectedFiles
        );
      });

      // 删除分类
      deleteCategoryBtn.addEventListener('click', () => {
        const select = document.getElementById('categoryDeleteSelect');
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
      });

      // 显示二维码分享
      function showQRCode(url) {
        currentShareUrl = url;
        const qrcodeDiv = document.getElementById('qrcode');
        qrcodeDiv.innerHTML = '';
        new QRCode(qrcodeDiv, {
          text: url,
          width: 200,
          height: 200,
          colorDark: "#000000",
          colorLight: "#ffffff",
          correctLevel: QRCode.CorrectLevel.H
        });
        qrModal.classList.add('show');
      }

      // 复制URL
      qrCopyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(currentShareUrl)
          .then(() => {
            qrCopyBtn.textContent = '✓ 已复制';
            setTimeout(() => {
              qrCopyBtn.textContent = '复制链接';
            }, 2000);
          })
          .catch(err => {
            console.error('复制失败:', err);
            showConfirmModal('复制失败，请手动复制', null, true);
          });
      });

      // 关闭二维码弹窗
      qrCloseBtn.addEventListener('click', () => {
        qrModal.classList.remove('show');
      });

      // 显示确认弹窗
      function showConfirmModal(message, callback, alertOnly = false) {
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

      // 关闭确认弹窗
      function closeConfirmModal() {
        confirmModal.classList.remove('show');
      }

      // 确认按钮事件
      confirmModalConfirm.addEventListener('click', () => {
        if (currentConfirmCallback) {
          currentConfirmCallback();
        }
        closeConfirmModal();
      });

      // 取消按钮事件
      confirmModalCancel.addEventListener('click', closeConfirmModal);

      // 点击弹窗外部关闭弹窗
      window.addEventListener('click', (event) => {
        if (event.target === confirmModal) {
          closeConfirmModal();
        }
        if (event.target === qrModal) {
          qrModal.classList.remove('show');
        }
        if (event.target === editSuffixModal) {
          editSuffixModal.classList.remove('show');
        }
      });

      // 删除单个文件
      async function deleteFile(url, card) {
        try {
          const response = await fetch('/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: url })
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || '删除失败');
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

      // 删除选中的文件
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

      // 删除分类
      async function deleteCategory() {
        const select = document.getElementById('categoryDeleteSelect');
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

      // 分享文件
      function shareFile(url) {
        showQRCode(url);
      }

      // 淇敼鍚庣紑
      let currentEditUrl = '';

      // 修改后缀
      function showEditSuffixModal(url) {
        currentEditUrl = url;
        
        // 获取当前后缀
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/');
        const fileName = pathParts[pathParts.length - 1];
        const fileNameParts = fileName.split('.');
        const extension = fileNameParts.pop(); // 获取扩展名
        const currentSuffix = fileNameParts.join('.'); // 获取当前后缀
        
        if (editSuffixInput) {
          editSuffixInput.value = currentSuffix;
          editSuffixModal.classList.add('show');
        }
      }

      if (editSuffixCancel) {
        editSuffixCancel.addEventListener('click', () => {
          editSuffixModal.classList.remove('show');
        });
      }

      if (editSuffixConfirm) {
        editSuffixConfirm.addEventListener('click', async () => {
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
              // 更新成功，隐藏弹窗
              editSuffixModal.classList.remove('show');
              
              // 更新页面上的URL
              const card = document.querySelector('[data-url="' + currentEditUrl + '"]');
              if (card) {
                // 更新卡片的URL值
                card.setAttribute('data-url', data.newUrl);
                
                // 更新卡片中的按钮URL
                const copyBtn = card.querySelector('.btn-copy');
                const downBtn = card.querySelector('.btn-down');
                const shareBtn = card.querySelector('.btn-share');
                const editBtn = card.querySelector('.btn-edit');
                
                if (copyBtn) copyBtn.setAttribute('data-url', data.newUrl);
                if (downBtn) downBtn.href = data.newUrl;
                if (shareBtn) shareBtn.setAttribute('data-url', data.newUrl);
                if (editBtn) editBtn.setAttribute('data-url', data.newUrl);
                
                // 更新描述中的文件名
                const fileNameElement = card.querySelector('.file-info div:first-child');
                if (fileNameElement) {
                  const urlObj = new URL(data.newUrl);
                  const fileName = urlObj.pathname.split('/').pop();
                  fileNameElement.textContent = fileName;
                }
              }
              
              showConfirmModal(data.msg, null, true);
            } else {
              showConfirmModal(data.msg || '修改后缀失败', null, true);
            }
          } catch (error) {
            showConfirmModal('修改后缀时出错：' + error.message, null, true);
          }
        });
      }

      // 复制到剪贴板
      function copyToClipboard(text) {
        navigator.clipboard.writeText(text)
          .then(() => {
            showConfirmModal('已复制到剪贴板', null, true);
          })
          .catch(() => {
            showConfirmModal('复制失败，请手动复制', null, true);
          });
      }

      // 点击弹窗外部关闭弹窗
      window.addEventListener('click', (event) => {
        if (event.target === confirmModal) {
          closeConfirmModal();
        }
        if (event.target === qrModal) {
          qrModal.classList.remove('show');
        }
        if (event.target === editSuffixModal) {
          editSuffixModal.classList.remove('show');
        }
      });
    </script>
  </body>
  </html>`;
}

async function handleUpdateSuffixRequest(request, config) {
  try {
    const { fileName, suffix } = await request.json();

    if (!fileName || !suffix) {
      return new Response(JSON.stringify({
        status: 0,
        message: '文件名和后缀不能为空'
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    const newFileName = suffix + '.' + fileName.split('.').pop();
    
    let fileUrl;
    
    // 检查文件是否存在于R2存储
    if (config.bucket) {
      try {
        const file = await config.bucket.get(fileName);
        if (file) {
          // 复制文件到新名称
          const fileData = await file.arrayBuffer();
          await storeFile(fileData, newFileName, file.httpMetadata.contentType, config);
          
          // 删除旧文件
          await deleteFile(fileName, config);
          
          // 更新数据库中的文件名
          await config.database.prepare('UPDATE files SET fileId = ?, url = ? WHERE fileId = ?')
            .bind(newFileName, `https://${config.domain}/${newFileName}`, fileName).run();
            
          fileUrl = `https://${config.domain}/${newFileName}`;
        }
      } catch (error) {
        console.error('处理R2文件重命名失败:', error);
        // 如果R2操作失败，继续尝试数据库更新
      }
    }
    
    // 如果没有R2或R2操作失败，尝试只更新数据库
    if (!fileUrl) {
      const oldUrl = `https://${config.domain}/${fileName}`;
      fileUrl = `https://${config.domain}/${newFileName}`;
      
      // 尝试更新数据库记录
      await config.database.prepare('UPDATE files SET fileId = ?, url = ? WHERE fileId = ? OR url = ?')
        .bind(newFileName, fileUrl, fileName, oldUrl).run();
    }

    return new Response(JSON.stringify({
      status: 1,
      url: fileUrl
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('更新后缀失败:', error);
    return new Response(JSON.stringify({
      status: 0,
      message: '更新后缀失败: ' + error.message
    }), { headers: { 'Content-Type': 'application/json' } });
  }
}

// 修改generateNewUrl函数，直接使用域名和文件名生成URL
function generateNewUrl(url, suffix) {
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

// 从MIME类型获取文件扩展名
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
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/zip': 'zip',
    'application/x-rar-compressed': 'rar',
    'text/plain': 'txt',
    'text/html': 'html',
    'text/css': 'css',
    'text/javascript': 'js'
  };
  
  return mimeMap[mimeType] || 'bin';
}

// 上传文件到R2对象存储
async function uploadToR2(arrayBuffer, fileName, mimeType, config) {
  try {
    return await storeFile(arrayBuffer, fileName, mimeType, config);
  } catch (error) {
    console.error('上传到R2失败:', error);
    throw new Error(`上传到存储服务失败: ${error.message}`);
  }
}

// 添加用于处理R2/Telegram存储操作的通用函数
async function storeFile(arrayBuffer, fileName, mimeType, config) {
  if (config.bucket) {
    try {
      await config.bucket.put(fileName, arrayBuffer, {
        httpMetadata: { contentType: mimeType || 'application/octet-stream' }
      });
      return `https://${config.domain}/${fileName}`;
    } catch (error) {
      console.error('R2存储失败，尝试退回到Telegram存储:', error);
      // 如果R2操作失败，尝试使用Telegram
      return await storeFileInTelegram(arrayBuffer, fileName, mimeType, config);
    }
  } else {
    // 没有配置R2，使用Telegram
    return await storeFileInTelegram(arrayBuffer, fileName, mimeType, config);
  }
}

async function storeFileInTelegram(arrayBuffer, fileName, mimeType, config) {
  if (!config.tgBotToken || !config.tgStorageChatId) {
    throw new Error('未配置Telegram存储参数 (TG_BOT_TOKEN 和 TG_STORAGE_CHAT_ID)');
  }
  
  // 创建FormData对象模拟文件上传
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
    const fileUrl = await getTelegramFileUrl(fileId, config.tgBotToken);
    return fileUrl;
  } else {
    throw new Error('Telegram存储失败：' + JSON.stringify(result));
  }
}

async function getFile(fileId, config) {
  if (config.bucket) {
    try {
      return await config.bucket.get(fileId);
    } catch (error) {
      console.error('R2获取文件失败:', error);
      // 如果是存储在Telegram的文件，可能需要其他方式获取
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
  return true; // 如果没有R2桶，假设文件已删除或不需要删除
}
