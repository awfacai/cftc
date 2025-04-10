// 数据库初始化函数
async function initDatabase(config) {
  console.log("开始数据库初始化..."); // Added log
  try {
    // 测试数据库连接
    console.log("正在测试数据库连接..."); // Added log
    await config.database.prepare("SELECT 1").run();
    console.log("数据库连接成功");
  } catch (error) {
    console.error(`数据库连接测试失败: ${error.message}`, error); // Log full error
    throw new Error(`数据库连接测试失败: ${error.message}`); // Rethrow with more context
  }

  // 创建必要的表结构
  try {
    console.log("正在创建/检查分类表..."); // Added log
    // 创建分类表
    await config.database.prepare(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      )
    `).run();
    console.log("分类表检查完成");

    console.log("正在创建/检查用户设置表..."); // Added log
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

    console.log("正在创建/检查文件表..."); // Added log
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
    console.log("正在检查并添加缺失的列..."); // Added log
    const columnsAdded = await checkAndAddMissingColumns(config);
    if (!columnsAdded) {
       console.warn("检查或添加缺失列时遇到问题，但继续执行。"); // Added log
       // Decide if we should throw here or allow continuation
    } else {
        console.log("缺失列检查/添加完成。"); // Added log
    }

    // 初始化默认分类
    console.log("正在检查/创建默认分类..."); // Added log
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
    console.log("准备开始验证数据库结构..."); // Added log
    await validateDatabaseStructure(config);
    console.log("数据库结构验证调用完成。"); // Added log
    
    console.log("数据库初始化成功完成"); // Changed log message for clarity
  } catch (error) {
    console.error(`数据库初始化过程中发生严重错误: ${error.message}`, error); // Log full error
    // It's crucial to log the specific error here before the generic message is returned
    throw new Error(`数据库初始化过程中发生错误: ${error.message}`); // Rethrow
  }
}

// 验证数据库结构完整性
async function validateDatabaseStructure(config) {
  console.log("开始验证数据库结构..."); // Changed log
  try {
    // 检查categories表结构
    console.log("验证 categories 表..."); // Added log
    const categoriesColumns = await config.database.prepare(`PRAGMA table_info(categories)`).all();
    const hasCategoriesRequiredColumns = categoriesColumns.results.some(col => col.name === 'id') && 
                                         categoriesColumns.results.some(col => col.name === 'name') &&
                                         categoriesColumns.results.some(col => col.name === 'created_at');
    
    if (!hasCategoriesRequiredColumns) {
      console.warn("分类表结构不完整，尝试重建...");
      await recreateCategoriesTable(config);
    } else {
       console.log("categories 表结构完整。"); // Added log
    }
    
    // 检查user_settings表结构
    console.log("验证 user_settings 表..."); // Added log
    const userSettingsColumns = await config.database.prepare(`PRAGMA table_info(user_settings)`).all();
    const hasUserSettingsRequiredColumns = userSettingsColumns.results.some(col => col.name === 'chat_id') && 
                                           userSettingsColumns.results.some(col => col.name === 'storage_type') &&
                                           userSettingsColumns.results.some(col => col.name === 'category_id') &&
                                           userSettingsColumns.results.some(col => col.name === 'custom_suffix') &&
                                           userSettingsColumns.results.some(col => col.name === 'waiting_for');
    
    if (!hasUserSettingsRequiredColumns) {
      console.warn("用户设置表结构不完整，尝试重建...");
      await recreateUserSettingsTable(config);
    } else {
       console.log("user_settings 表结构完整。"); // Added log
    }
    
    // 检查files表结构
    console.log("验证 files 表..."); // Added log
    const filesColumns = await config.database.prepare(`PRAGMA table_info(files)`).all();
    // Re-checking the required columns based on the CREATE statement and recent changes
    const hasFilesRequiredColumns = filesColumns.results.some(col => col.name === 'id') && // Assuming PK is required
                                    filesColumns.results.some(col => col.name === 'url') &&
                                    filesColumns.results.some(col => col.name === 'fileId') &&
                                    filesColumns.results.some(col => col.name === 'message_id') &&
                                    filesColumns.results.some(col => col.name === 'created_at') &&
                                    filesColumns.results.some(col => col.name === 'storage_type') &&
                                    filesColumns.results.some(col => col.name === 'category_id') &&
                                    filesColumns.results.some(col => col.name === 'chat_id') && // Added check
                                    filesColumns.results.some(col => col.name === 'custom_suffix'); // Added check

    if (!hasFilesRequiredColumns) {
      console.warn("文件表结构不完整，尝试重建...");
      await recreateFilesTable(config);
    } else {
       console.log("files 表结构完整。"); // Added log
    }
    
    console.log("数据库结构验证成功完成"); // Changed log
  } catch (error) {
    console.error(`数据库结构验证过程中发生错误: ${error.message}`, error); // Log full error
    // Let's re-throw the error during validation for now to make failures explicit
    throw new Error(`数据库结构验证失败: ${error.message}`);
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
  console.log(`确保列 ${columnName} 存在于表 ${tableName} 中...`); // Added log
  try {
    // 先检查列是否存在
    console.log(`检查列 ${columnName} 是否存在于 ${tableName}...`); // Added log
    const tableInfo = await config.database.prepare(`PRAGMA table_info(${tableName})`).all();
    const columnExists = tableInfo.results.some(col => col.name === columnName);
    
    if (columnExists) {
      console.log(`列 ${columnName} 已存在于表 ${tableName} 中`);
      return true; // Indicate success (column exists)
    }
    
    // 列不存在，添加它
    console.log(`列 ${columnName} 不存在于表 ${tableName}，尝试添加...`); // Added log
    try {
      await config.database.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`).run();
      console.log(`列 ${columnName} 已成功添加到表 ${tableName}`);
      return true; // Indicate success (column added)
    } catch (alterError) {
      console.warn(`添加列 ${columnName} 到 ${tableName} 时发生错误: ${alterError.message}. 尝试再次检查列是否存在...`, alterError); // Log the specific ALTER error
      // Re-check if the column exists after the error, perhaps due to a race condition or specific D1 behavior
      const tableInfoAfterAttempt = await config.database.prepare(`PRAGMA table_info(${tableName})`).all();
      if (tableInfoAfterAttempt.results.some(col => col.name === columnName)) {
         console.log(`列 ${columnName} 在添加尝试失败后被发现存在于表 ${tableName} 中。`);
         return true; // Column now exists, treat as success
      } else {
         console.error(`添加列 ${columnName} 到 ${tableName} 失败，并且再次检查后列仍不存在。`);
         // Decide if we should throw or return false
         // Returning false allows checkAndAddMissingColumns to report overall status
         return false; 
      }
    }
  } catch (error) {
    // This top-level catch handles errors from PRAGMA or re-checking logic
    console.error(`检查或添加表 ${tableName} 中的列 ${columnName} 时发生严重错误: ${error.message}`, error);
    return false; // Indicate failure
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
      if (userSetting.waiting_for === 'new_category' && update.message.text) {
        // 用户正在创建新分类
        const categoryName = update.message.text.trim();
        
        try {
          // 检查分类名是否已存在
          const existingCategory = await config.database.prepare('SELECT id FROM categories WHERE name = ?').bind(categoryName).first();
          if (existingCategory) {
            await sendMessage(chatId, `⚠️ 分类"${categoryName}"已存在`, config.tgBotToken);
          } else {
            // 创建新分类
            const time = Date.now();
            await config.database.prepare('INSERT INTO categories (name, created_at) VALUES (?, ?)').bind(categoryName, time).run();
            
            // 获取新创建的分类ID
            const newCategory = await config.database.prepare('SELECT id FROM categories WHERE name = ?').bind(categoryName).first();
            
            // 设置为当前分类
            await config.database.prepare('UPDATE user_settings SET category_id = ?, waiting_for = NULL WHERE chat_id = ?').bind(newCategory.id, chatId).run();
            
            await sendMessage(chatId, `✅ 分类"${categoryName}"创建成功并已设为当前分类`, config.tgBotToken);
          }
        } catch (error) {
          console.error('创建分类失败:', error);
          await sendMessage(chatId, `❌ 创建分类失败: ${error.message}`, config.tgBotToken);
        }
        
        // 清除等待状态
        await config.database.prepare('UPDATE user_settings SET waiting_for = NULL WHERE chat_id = ?').bind(chatId).run();
        
        // 更新面板
        userSetting.waiting_for = null;
        await sendPanel(chatId, userSetting, config);
        return new Response('OK');
      }
      // 处理后缀设置
      else if (update.message.text && userSetting.waiting_for === 'waiting_suffix') {
        // 用户正在设置后缀
        let newSuffix = update.message.text.trim();
        
        // 检查是否要清除后缀
        if (newSuffix.toLowerCase() === '无' || newSuffix.toLowerCase() === 'none') {
          newSuffix = null;
        }
        
        // 更新用户设置
        await config.database.prepare(`
          UPDATE user_settings 
          SET custom_suffix = ?, waiting_for = NULL 
          WHERE chat_id = ?
        `).bind(newSuffix, chatId).run();
        
        // 发送确认消息
        await sendMessage(
          chatId, 
          newSuffix ? `✅ 后缀已设置为: ${newSuffix}` : '✅ 后缀已清除', 
          config.tgBotToken
        );
        
        // 重新发送设置面板
        userSetting = await config.database.prepare('SELECT * FROM user_settings WHERE chat_id = ?').bind(chatId).first();
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

      await handleCallbackQuery(update.callback_query, config, userSetting);
    }

    return new Response('OK');
  } catch (error) {
    console.error('Error handling webhook:', error);
    return new Response('Error processing webhook', { status: 500 });
  }
}

async function sendPanel(chatId, userSetting, config) {
  try {
    // 获取用户当前分类
    const categoryId = userSetting.category_id || null;
    
    // 获取所有分类
    const categories = await config.database.prepare(`
      SELECT id, name FROM categories ORDER BY name
    `).all();
    
    // 构建分类按钮
    const categoryButtons = categories.results.map(cat => ({
      text: `📁 ${cat.name} ${cat.id === categoryId ? '✓' : ''}`,
      callback_data: `setCategory:${cat.id}`
    }));
    
    // 将分类按钮分组，每行两个
    const categoryRows = [];
    for (let i = 0; i < categoryButtons.length; i += 2) {
      categoryRows.push(categoryButtons.slice(i, i + 2));
    }
    
    // 构建存储类型按钮
    const storageTypeButtons = [
      {
        text: `📤 Telegram ${userSetting.storage_type === 'telegram' ? '✓' : ''}`,
        callback_data: 'setStorage:telegram'
      },
      {
        text: `☁️ 云存储 ${userSetting.storage_type === 'r2' ? '✓' : ''}`,
        callback_data: 'setStorage:r2'
      }
    ];
    
    // 添加修改后缀按钮
    const suffixButton = [{
      text: '🔄 修改后缀',
      callback_data: 'setSuffix'
    }];
    
    // 构建完整的内联键盘
    const inlineKeyboard = [
      storageTypeButtons,
      ...categoryRows,
      suffixButton,
      [{ text: '❌ 关闭', callback_data: 'close' }]
    ];
    
    // 发送面板消息
    const storageType = userSetting.storage_type === 'r2' ? '☁️ 云存储' : '📤 Telegram';
    const category = categoryId 
      ? categories.results.find(c => c.id === categoryId)?.name || '无' 
      : '无';
    
    // 添加后缀显示
    const customSuffix = userSetting.custom_suffix || '无';
    
    const message = `
📋 *上传设置*

当前存储: ${storageType}
当前分类: ${category}
当前后缀: ${customSuffix}

请发送图片或文件进行上传，或通过按钮修改设置。
    `;
    
    await sendMessage(chatId, message, config.tgBotToken, null, {
      reply_markup: JSON.stringify({
        inline_keyboard: inlineKeyboard
      }),
      parse_mode: 'Markdown'
    });
    
    return true;
  } catch (error) {
    console.error(`发送面板时出错: ${error.message}`);
    await sendMessage(chatId, `发送面板时出错: ${error.message}`, config.tgBotToken);
    return false;
  }
}

async function handleCallbackQuery(callbackQuery, config, userSetting) {
  // 获取回调查询数据
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data;
  
  try {
    // 根据回调数据执行不同操作
    if (data === 'close') {
      // 关闭面板
      await fetch(`https://api.telegram.org/bot${config.tgBotToken}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text: '面板已关闭'
        })
      });
      return true;
    } else if (data.startsWith('setStorage:')) {
      // 设置存储类型
      const newStorageType = data.split(':')[1];
      
      // 更新用户设置
      await config.database.prepare(`
        UPDATE user_settings 
        SET storage_type = ? 
        WHERE chat_id = ?
      `).bind(newStorageType, chatId.toString()).run();
      
      // 重新发送面板
      await sendPanel(chatId, { ...userSetting, storage_type: newStorageType }, config);
      return true;
    } else if (data.startsWith('setCategory:')) {
      // 设置分类
      const categoryId = parseInt(data.split(':')[1]);
      
      // 更新用户设置
      await config.database.prepare(`
        UPDATE user_settings 
        SET category_id = ? 
        WHERE chat_id = ?
      `).bind(categoryId, chatId.toString()).run();
      
      // 重新发送面板
      await sendPanel(chatId, { ...userSetting, category_id: categoryId }, config);
      return true;
    } else if (data === 'setSuffix') {
      // 提示用户输入新的后缀
      await fetch(`https://api.telegram.org/bot${config.tgBotToken}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text: '请回复此消息，输入您想要设置的文件后缀\n(例如：.jpg 或 _thumb)\n\n输入"无"或"none"可清除后缀',
          reply_markup: JSON.stringify({
            force_reply: true,
            selective: true
          })
        })
      });
      
      // 设置用户状态为等待输入后缀
      await config.database.prepare(`
        UPDATE user_settings 
        SET waiting_for = 'waiting_suffix' 
        WHERE chat_id = ?
      `).bind(chatId.toString()).run();
      
      return true;
    } else {
      // 重新发送面板
      await sendPanel(chatId, userSetting, config);
      return true;
    }
  } catch (error) {
    console.error(`处理回调查询时出错: ${error.message}`);
    return false;
  }
}

async function handleMediaUpload(chatId, file, isDocument, config, userSetting) {
  try {
    // 第一步：获取文件内容
    const response = await fetch(`https://api.telegram.org/bot${config.tgBotToken}/getFile?file_id=${file.file_id}`);
    const data = await response.json();
    if (!data.ok) throw new Error(`获取文件路径失败: ${JSON.stringify(data)}`);

    const telegramUrl = `https://api.telegram.org/file/bot${config.tgBotToken}/${data.result.file_path}`;

    // 获取文件内容
    const fileResponse = await fetch(telegramUrl);
    const fileBuffer = await fileResponse.arrayBuffer();

    // 第二步：处理文件名和类型
    let fileName = '';
    let ext = '';

    if (isDocument) {
      fileName = file.file_name;
      ext = fileName.split('.').pop();
    } else {
      // 照片没有文件名，使用时间戳
      ext = 'jpg';
      fileName = `${Date.now()}.${ext}`;
    }
    
    // 第三步：根据存储类型(r2 或 telegram)处理文件存储
    const storageType = userSetting && userSetting.storage_type ? userSetting.storage_type : 'r2';
    
    // 获取分类ID
    let categoryId = null;
    if (userSetting && userSetting.category_id) {
      categoryId = userSetting.category_id;
    } else {
      // 找默认分类
      const defaultCategory = await config.database.prepare('SELECT id FROM categories WHERE name = ?').bind('默认分类').first();
      if (defaultCategory) {
        categoryId = defaultCategory.id;
      }
    }
    
    let finalUrl, dbFileId, dbMessageId;
    
    // 与网页上传一致，使用时间戳作为文件名
    const timestamp = Date.now();
    const key = `${timestamp}.${ext}`;
    
    if (storageType === 'r2' && config.bucket) {
      // 上传到R2存储
      await config.bucket.put(key, fileBuffer, { 
        httpMetadata: { contentType: `image/${ext}` } 
      });
      finalUrl = `https://${config.domain}/${key}`;
      dbFileId = key;
      dbMessageId = 0;
    } else {
      // 使用Telegram存储
      // 根据文件类型选择不同的发送方法
      const typeMap = {
        image: { method: 'sendPhoto', field: 'photo' },
        video: { method: 'sendVideo', field: 'video' },
        audio: { method: 'sendAudio', field: 'audio' }
      };
      let { method = 'sendDocument', field = 'document' } = typeMap[ext] || {};
      
      if (['application', 'text'].includes(ext)) {
        method = 'sendDocument';
        field = 'document';
      }
      
      // 重新发送到存储聊天
      const tgFormData = new FormData();
      tgFormData.append('chat_id', config.tgStorageChatId);
      tgFormData.append(field, new Blob([fileBuffer], { type: `image/${ext}` }), fileName);
      
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
      
      finalUrl = `https://${config.domain}/${key}`;
      dbFileId = fileId;
      dbMessageId = messageId;
    }
    
    // 第四步：写入数据库，与网页上传完全一致的格式
    const time = Math.floor(timestamp / 1000);
    
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
      key,  // 使用key作为file_name
      fileBuffer.length,
      `image/${ext}`,
      chatId,
      categoryId,
      storageType
    ).run();
    
    // 第五步：发送成功消息给用户
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
    await sendMessage(chatId, `❌ 上传失败: ${error.message}`, config.tgBotToken);
  }
}

async function getTelegramFileUrl(fileId, botToken, config) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
    const data = await response.json();
    if (!data.ok) throw new Error('获取文件路径失败');
    
    return `https://api.telegram.org/file/bot${botToken}/${data.result.file_path}`;
  } catch (error) {
    console.error('获取Telegram文件URL失败:', error);
    throw error;
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
  try {
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname.slice(1));

    if (!path) {
      return new Response('Not Found', { status: 404 });
    }
    
    // 设置公共头部，确保图片等媒体可以正常显示
    const getCommonHeaders = (contentType) => {
      const headers = new Headers();
      headers.set('Content-Type', contentType);
      headers.set('Access-Control-Allow-Origin', '*');
      
      // 关键：确保媒体文件使用inline展示
      if (contentType.startsWith('image/') || 
          contentType.startsWith('video/') || 
          contentType.startsWith('audio/')) {
        headers.set('Content-Disposition', 'inline');
      }
      
      // 添加缓存相关头
      headers.set('Cache-Control', 'public, max-age=31536000');
      
      return headers;
    };

    // 先尝试直接从R2存储获取文件
    if (config.bucket) {
      try {
        const object = await config.bucket.get(path);
        
        if (object) {
          const contentType = object.httpMetadata.contentType || getContentType(path.split('.').pop());
          const headers = getCommonHeaders(contentType);
          object.writeHttpMetadata(headers);
          headers.set('etag', object.httpEtag);
          
          return new Response(object.body, { headers });
        }
      } catch (error) {
        console.error('R2获取文件出错:', error);
        // 继续尝试其他方式获取文件
      }
    }

    // 从数据库查询文件记录
    let file;
    
    // 先通过完整URL查询
    const urlPattern = `https://${config.domain}/${path}`;
    file = await config.database.prepare('SELECT * FROM files WHERE url = ?').bind(urlPattern).first();
    
    // 如果上面没找到，再用文件名作为fileId查询
    if (!file) {
      file = await config.database.prepare('SELECT * FROM files WHERE fileId = ?').bind(path).first();
    }
    
    // 最后尝试使用路径的最后部分（文件名）查询
    if (!file) {
      const fileName = path.split('/').pop();
      file = await config.database.prepare('SELECT * FROM files WHERE file_name = ?').bind(fileName).first();
    }

    if (!file) {
      return new Response('File not found', { status: 404 });
    }

    // 根据存储类型处理文件
    if (file.storage_type === 'telegram') {
      // 处理Telegram存储的文件
      try {
        // 从Telegram获取文件链接
        const response = await fetch(`https://api.telegram.org/bot${config.tgBotToken}/getFile?file_id=${file.fileId}`);
        const data = await response.json();
        
        if (!data.ok) {
          return new Response('Failed to get file from Telegram', { status: 500 });
        }
        
        const telegramUrl = `https://api.telegram.org/file/bot${config.tgBotToken}/${data.result.file_path}`;
        const fileResponse = await fetch(telegramUrl);
        
        if (!fileResponse.ok) {
          return new Response('Failed to fetch file from Telegram', { status: fileResponse.status });
        }
        
        const contentType = file.mime_type || getContentType(path.split('.').pop());
        const headers = getCommonHeaders(contentType);
        
        // 流式传输文件内容，避免内存占用过大
        return new Response(fileResponse.body, { headers });
      } catch (error) {
        console.error('处理Telegram文件出错:', error);
        return new Response('Error processing Telegram file', { status: 500 });
      }
    } else if (file.storage_type === 'r2' && config.bucket) {
      // 如果是R2存储但前面直接访问失败，再尝试通过fileId获取
      try {
        const object = await config.bucket.get(file.fileId);
        
        if (object) {
          const contentType = object.httpMetadata.contentType || file.mime_type || getContentType(path.split('.').pop());
          const headers = getCommonHeaders(contentType);
          object.writeHttpMetadata(headers);
          headers.set('etag', object.httpEtag);
          
          return new Response(object.body, { headers });
        }
      } catch (error) {
        console.error('通过fileId从R2获取文件出错:', error);
      }
    }
    
    // 如果上述方法都失败，尝试重定向到文件URL
    if (file.url && file.url !== urlPattern) {
      return Response.redirect(file.url, 302);
    }
    
    return new Response('File not available', { status: 404 });
  } catch (error) {
    console.error('处理文件请求出错:', error);
    return new Response('Internal Server Error', { status: 500 });
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

async function sendMessage(chatId, text, botToken, replyToMessageId = null, options = {}) {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        reply_to_message_id: replyToMessageId,
        ...options
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
```
}

async function handleUpdateSuffixRequest(request, config) {
  try {
    const { url, suffix } = await request.json();
    
    if (!url) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: '缺少URL参数' 
      }), { 
        headers: { 'Content-Type': 'application/json' } 
      });
    }
    
    // 从URL中提取文件名
    const fileName = url.split('/').pop();
    
    // 获取文件ID，通常是文件名的第一部分(不含扩展名)
    const fileId = fileName.split('.')[0];
    
    // 更新数据库中的custom_suffix字段
    await config.database.prepare(`
      UPDATE files 
      SET custom_suffix = ? 
      WHERE id = ? OR file_id = ?
    `).bind(suffix, fileId, fileId).run();
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: '后缀修改成功',
      newUrl: generateNewUrl(url, suffix)
    }), { 
      headers: { 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    console.error('修改后缀出错:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      message: `修改后缀失败: ${error.message}` 
    }), { 
      headers: { 'Content-Type': 'application/json' },
      status: 500
    });
  }
}

function generateNewUrl(url, suffix) {
  const urlParts = url.split('/');
  const fileName = urlParts.pop();
  const fileNameParts = fileName.split('.');
  const ext = fileNameParts.pop();
  const baseName = fileNameParts.join('.');
  const newFileName = `${baseName}${suffix ? `-${suffix}` : ''}.${ext}`;
  urlParts.push(newFileName);
  return urlParts.join('/');
}

async function sendPanel(chatId, userSetting, config) {
  const {
    is_admin,
    is_premium,
    is_vip,
    is_whitelist,
    is_blacklist,
    is_banned,
    is_bot,
    is_group,
    is_channel,
    is_supergroup,
    is_private,
    is_public,
    is_group_chat,
    is_channel_chat,
    is_supergroup_chat,
    is_private_chat,
    is_public_chat,
    is_bot_chat,
    is_group_admin,
    is_channel_admin,
    is_supergroup_admin,
    is_private_admin,
    is_public_admin,
    is_bot_admin,
    is_group_member,
    is_channel_member,
    is_supergroup_member,
    is_private_member,
    is_public_member,
    is_bot_member,
    is_group_creator,
    is_channel_creator,
    is_supergroup_creator,
    is_private_creator,
    is_public_creator,
    is_bot_creator,
    is_group_owner,
    is_channel_owner,
    is_supergroup_owner,
    is_private_owner,
    is_public_owner,
    is_bot_owner,
    is_group_founder,
    is_channel_founder,
    is_supergroup_founder,
    is_private_founder,
    is_public_founder,
    is_bot_founder,
    is_group_manager,
    is_channel_manager,
    is_supergroup_manager,
    is_private_manager,
    is_public_manager,
    is_bot_manager,
    is_group_banned,
    is_channel_banned,
    is_supergroup_banned,
    is_private_banned,
    is_public_banned,
    is_bot_banned,
    is_group_restricted,
    is_channel_restricted,
    is_supergroup_restricted,
    is_private_restricted,
    is_public_restricted,
    is_bot_restricted,
    is_group_left,
    is_channel_left,
    is_supergroup_left,
    is_private_left,
    is_public_left,
    is_bot_left,
    is_group_kicked,
    is_channel_kicked,
    is_supergroup_kicked,
    is_private_kicked,
    is_public_kicked,
    is_bot_kicked,
    is_group_muted,
    is_channel_muted,
    is_supergroup_muted,
    is_private_muted,
    is_public_muted,
    is_bot_muted,
    is_group_unmuted,
    is_channel_unmuted,
    is_supergroup_unmuted,
    is_private_unmuted,
    is_public_unmuted,
    is_bot_unmuted,
    is_group_unbanned,
    is_channel_unbanned,
    is_supergroup_unbanned,
    is_private_unbanned,
    is_public_unbanned,
    is_bot_unbanned,
    is_group_unrestricted,
    is_channel_unrestricted,
    is_supergroup_unrestricted,
    is_private_unrestricted,
    is_public_unrestricted,
    is_bot_unrestricted,
    is_group_unleft,
    is_channel_unleft,
    is_supergroup_unleft,
    is_private_unleft,
    is_public_unleft,
    is_bot_unleft,
    is_group_unkicked,
    is_channel_unkicked,
    is_supergroup_unkicked,
    is_private_unkicked,
    is_public_unkicked,
    is_bot_unkicked,
    is_group_unmuted,
    is_channel_unmuted,
    is_supergroup_unmuted,
    is_private_unmuted,
    is_public_unmuted,
    is_bot_unmuted,
    is_group_unbanned,
    is_channel_unbanned,
    is_supergroup_unbanned,
    is_private_unbanned,
    is_public_unbanned,
    is_bot_unbanned,
    is_group_unrestricted,
    is_channel_unrestricted,
    is_supergroup_unrestricted,
    is_private_unrestricted,
    is_public_unrestricted,
    is_bot_unrestricted,
    is_group_unleft,
    is_channel_unleft,
    is_supergroup_unleft,
    is_private_unleft,
    is_public_unleft,
    is_bot_unleft,
    is_group_unkicked,
    is_channel_unkicked,
    is_supergroup_unkicked,
    is_private_unkicked,
    is_public_unkicked,
    is_bot_unkicked,
    is_group_unmuted,
    is_channel_unmuted,
    is_supergroup_unmuted,
    is_private_unmuted,
    is_public_unmuted,
    is_bot_unmuted,
    is_group_unbanned,
    is_channel_unbanned,
    is_supergroup_unbanned,
    is_private_unbanned,
    is_public_unbanned,
    is_bot_unbanned,
    is_group_unrestricted,
    is_channel_unrestricted,
    is_supergroup_unrestricted,
    is_private_unrestricted,
    is_public_unrestricted,
    is_bot_unrestricted,
    is_group_unleft,
    is_channel_unleft,
    is_supergroup_unleft,
    is_private_unleft,
    is_public_unleft,
    is_bot_unleft,
    is_group_unkicked,
    is_channel_unkicked,
    is_supergroup_unkicked,
    is_private_unkicked,
    is_public_unkicked,
    is_bot_unkicked,
    is_group_unmuted,
    is_channel_unmuted,
    is_supergroup_unmuted,
    is_private_unmuted,
    is_public_unmuted,
    is_bot_unmuted,
    is_group_unbanned,
    is_channel_unbanned,
    is_supergroup_unbanned,
    is_private_unbanned,
    is_public_unbanned,
    is_bot_unbanned,
    is_group_unrestricted,
    is_channel_unrestricted,
    is_supergroup_unrestricted,
    is_private_unrestricted,
    is_public_unrestricted,
    is_bot_unrestricted,
    is_group_unleft,
    is_channel_unleft,
    is_supergroup_unleft,
    is_private_unleft,
    is_public_unleft,
    is_bot_unleft,
    is_group_unkicked,
    is_channel_unkicked,
    is_supergroup_unkicked,
    is_private_unkicked,
    is_public_unkicked,
    is_bot_unkicked,
    is_group_unmuted,
    is_channel_unmuted,
    is_supergroup_unmuted,
    is_private_unmuted,
    is_public_unmuted,
    is_bot_unmuted,
    is_group_unbanned,
    is_channel_unbanned,
    is_supergroup_unbanned,
    is_private_unbanned,
    is_public_unbanned,
    is_bot_unbanned,
    is_group_unrestricted,
    is_channel_unrestricted,
    is_supergroup_unrestricted,
    is_private_unrestricted,
    is_public_unrestricted,
    is_bot_unrestricted,
    is_group_unleft,
    is_channel_unleft,
  const extension = fileNameParts.pop(); // 获取扩展名
  
  // 构建新的文件名：原始名称 + 后缀 + 扩展名
  const newFileName = fileNameParts.join('.') + suffix + '.' + extension;
  
  // 替换URL中的文件名部分
  return url.replace(fileName, newFileName);
}

function getFileName(url) {
  return url.split('/').pop();
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
    throw new Error('鏈厤缃甌elegram瀛樺偍鍙傛暟 (TG_BOT_TOKEN 鍜?TG_STORAGE_CHAT_ID)');
  }

  // 鍒涘缓FormData瀵硅薄妯℃嫙鏂囦欢涓婁紶
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
    throw new Error('Telegram瀛樺偍澶辫触: ' + JSON.stringify(result));
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
  try {
    // 检查R2存储是否可用
    if (config.bucket) {
      try {
        // 删除R2文件
        await config.bucket.delete(fileId);
        console.log(`已从R2删除文件: ${fileId}`);
      } catch (error) {
        console.error(`从R2删除文件时出错: ${error.message}`);
      }
    }
    
    // 从数据库中删除文件记录
    await config.database.prepare('DELETE FROM files WHERE file_id = ? OR url LIKE ?')
      .bind(fileId, `%${fileId}%`)
      .run();
      
    console.log(`已从数据库删除文件记录: ${fileId}`);
    return true;
  } catch (error) {
    console.error(`删除文件时出错: ${error.message}`);
    return false;
  }
}
