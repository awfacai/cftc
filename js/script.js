// Cloudflare Worker script for Telegram File Manager

// Global variables for configuration
let config = {
  botToken: '',
  allowedUsers: [],
  adminUsername: '',
  adminPasswordHash: ''
};

// Hook for Worker entry point
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

// Main request handler
async function handleRequest(request) {
  try {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Load configuration from environment or database
    await loadConfig();
    
    // Route handling
    if (path === '/') {
      // Serve main admin interface
      return new Response(renderAdminInterface(), {
        headers: { 'Content-Type': 'text/html' }
      });
    } else if (path === '/api/login') {
      // Handle admin login
      return handleLogin(request);
    } else if (path.startsWith('/api/')) {
      // Handle API requests
      const isAuthenticated = await checkAuthentication(request);
      
      if (!isAuthenticated && !path.startsWith('/api/public/')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      if (path === '/api/files') {
        return handleFilesAPI(request);
      } else if (path === '/api/settings') {
        return handleSettingsAPI(request);
      } else if (path === '/api/webhook') {
        return handleWebhookAPI(request);
      }
    } else if (path === '/webhook') {
      // Handle Telegram webhook
      return handleTelegramWebhook(request);
    } else if (path.startsWith('/file/')) {
      // Serve files
      return serveFile(request, path.slice(6));
    } else if (path.startsWith('/thumb/')) {
      // Serve thumbnails
      return serveThumbnail(request, path.slice(7));
    } else if (path === '/background') {
      // Serve Bing background image
      return getBingBackgroundImage();
    }
    
    // Not found
    return new Response('Not Found', { status: 404 });
  } catch (error) {
    console.error('Worker error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

// Load configuration from environment or database
async function loadConfig() {
  try {
    // Try to load from database
    const storedConfig = await DB.prepare('SELECT * FROM config LIMIT 1').first();
    
    if (storedConfig) {
      config.botToken = storedConfig.bot_token || '';
      config.allowedUsers = (storedConfig.allowed_users || '').split(',').filter(Boolean);
      config.adminUsername = storedConfig.admin_username || '';
      config.adminPasswordHash = storedConfig.admin_password_hash || '';
    } else {
      // Fallback to environment variables
      config.botToken = BOT_TOKEN || '';
      config.allowedUsers = (ALLOWED_USERS || '').split(',').filter(Boolean);
      config.adminUsername = ADMIN_USERNAME || 'admin';
      config.adminPasswordHash = ADMIN_PASSWORD_HASH || '';
    }
  } catch (error) {
    console.error('Config load error:', error);
    // Fallback to environment variables on error
    config.botToken = BOT_TOKEN || '';
    config.allowedUsers = (ALLOWED_USERS || '').split(',').filter(Boolean);
    config.adminUsername = ADMIN_USERNAME || 'admin';
    config.adminPasswordHash = ADMIN_PASSWORD_HASH || '';
  }
}

// Authentication check
async function checkAuthentication(request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }
  
  const token = authHeader.split(' ')[1];
  // Validate JWT token
  try {
    // Simple validation for demo, should use proper JWT validation
    const payload = JSON.parse(atob(token.split('.')[1]));
    const currentTime = Math.floor(Date.now() / 1000);
    
    if (payload.exp && payload.exp < currentTime) {
      return false; // Token expired
    }
    
    return payload.username === config.adminUsername;
  } catch (error) {
    return false;
  }
}

// Handle login request
async function handleLogin(request) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  try {
    const body = await request.json();
    const { username, password } = body;
    
    if (username !== config.adminUsername) {
      return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Validate password (should use proper password hashing and comparison)
    // This is a simplified example - use bcrypt or similar in production
    const passwordValid = await validatePassword(password, config.adminPasswordHash);
    
    if (!passwordValid) {
      return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Generate JWT token
    const token = generateJWT(username);
    
    return new Response(JSON.stringify({ token }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Invalid request' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Validate password (simplified - use proper hashing in production)
async function validatePassword(password, hash) {
  // This is a simplified example - use bcrypt or similar in production
  return hash === await sha256(password);
}

// Simple SHA-256 hash function
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Generate JWT token (simplified)
function generateJWT(username) {
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };
  
  const payload = {
    username: username,
    exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours expiry
    iat: Math.floor(Date.now() / 1000)
  };
  
  const headerEncoded = btoa(JSON.stringify(header));
  const payloadEncoded = btoa(JSON.stringify(payload));
  
  // In production, use a proper JWT library with secure signing
  const signature = btoa(JSON.stringify({ signed: true }));
  
  return `${headerEncoded}.${payloadEncoded}.${signature}`;
}

// Handle the files API
async function handleFilesAPI(request) {
  if (request.method === 'GET') {
    // Get all files with pagination
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const limit = Number(url.searchParams.get('limit')) || 10;
    const search = url.searchParams.get('search') || '';
    const fileType = url.searchParams.get('type') || 'all';
    
    try {
      const offset = (page - 1) * limit;
      
      let query = "SELECT * FROM files";
      const params = [];
      
      // Build where clause
      const whereConditions = [];
      
      if (search) {
        whereConditions.push("file_name LIKE ?");
        params.push(`%${search}%`);
      }
      
      if (fileType && fileType !== 'all') {
        whereConditions.push("file_type = ?");
        params.push(fileType);
      }
      
      if (whereConditions.length > 0) {
        query += " WHERE " + whereConditions.join(" AND ");
      }
      
      // Add order and pagination
      query += " ORDER BY upload_date DESC LIMIT ? OFFSET ?";
      params.push(limit, offset);
      
      // Count total for pagination
      let countQuery = "SELECT COUNT(*) as total FROM files";
      if (whereConditions.length > 0) {
        countQuery += " WHERE " + whereConditions.join(" AND ");
      }
      
      const filesStatement = await DB.prepare(query).bind(...params);
      const files = await filesStatement.all();
      
      const countStatement = await DB.prepare(countQuery).bind(...params.slice(0, params.length - 2));
      const { total } = await countStatement.first();
      
      return new Response(JSON.stringify({
        files: files.results,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit)
        }
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  } else if (request.method === 'DELETE') {
    // Delete a file
    try {
      const body = await request.json();
      const { fileId } = body;
      
      if (!fileId) {
        return new Response(JSON.stringify({ error: 'File ID is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Get file details from DB
      const fileStatement = await DB.prepare('SELECT * FROM files WHERE id = ?').bind(fileId);
      const file = await fileStatement.first();
      
      if (!file) {
        return new Response(JSON.stringify({ error: 'File not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Delete file from Telegram if possible (may not be allowed by API)
      if (file.telegram_file_id) {
        try {
          await deleteTelegramFile(file.telegram_file_id);
        } catch (telegramError) {
          console.error('Failed to delete file from Telegram:', telegramError);
          // Continue anyway, as we still want to delete from our DB
        }
      }
      
      // Delete file record from DB
      await DB.prepare('DELETE FROM files WHERE id = ?').bind(fileId).run();
      
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
  
  return new Response(JSON.stringify({ error: 'Method not supported' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Handle settings API
async function handleSettingsAPI(request) {
  if (request.method === 'GET') {
    // Return current settings (without sensitive info)
    return new Response(JSON.stringify({
      allowedUsers: config.allowedUsers,
      adminUsername: config.adminUsername,
      webhookUrl: `${new URL(request.url).origin}/webhook`
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } else if (request.method === 'POST') {
    // Update settings
    try {
      const body = await request.json();
      const { botToken, allowedUsers, adminUsername, adminPassword } = body;
      
      // Update configuration
      let updateQuery = 'UPDATE config SET ';
      const updateParams = [];
      const updateFields = [];
      
      if (botToken) {
        updateFields.push('bot_token = ?');
        updateParams.push(botToken);
        config.botToken = botToken;
      }
      
      if (allowedUsers) {
        updateFields.push('allowed_users = ?');
        const allowedUsersStr = Array.isArray(allowedUsers) ? allowedUsers.join(',') : allowedUsers;
        updateParams.push(allowedUsersStr);
        config.allowedUsers = Array.isArray(allowedUsers) ? allowedUsers : allowedUsers.split(',').filter(Boolean);
      }
      
      if (adminUsername) {
        updateFields.push('admin_username = ?');
        updateParams.push(adminUsername);
        config.adminUsername = adminUsername;
      }
      
      if (adminPassword) {
        const passwordHash = await sha256(adminPassword);
        updateFields.push('admin_password_hash = ?');
        updateParams.push(passwordHash);
        config.adminPasswordHash = passwordHash;
      }
      
      if (updateFields.length > 0) {
        updateQuery += updateFields.join(', ') + ' WHERE id = 1';
        try {
          await DB.prepare(updateQuery).bind(...updateParams).run();
        } catch (dbError) {
          // If record doesn't exist, create it
          const fields = [];
          const placeholders = [];
          const insertParams = [];
          
          if (botToken || botToken === '') {
            fields.push('bot_token');
            placeholders.push('?');
            insertParams.push(botToken);
          }
          
          if (allowedUsers || allowedUsers === '') {
            fields.push('allowed_users');
            placeholders.push('?');
            const allowedUsersStr = Array.isArray(allowedUsers) ? allowedUsers.join(',') : allowedUsers;
            insertParams.push(allowedUsersStr);
          }
          
          if (adminUsername) {
            fields.push('admin_username');
            placeholders.push('?');
            insertParams.push(adminUsername);
          }
          
          if (adminPassword) {
            fields.push('admin_password_hash');
            placeholders.push('?');
            const passwordHash = await sha256(adminPassword);
            insertParams.push(passwordHash);
          }
          
          if (fields.length > 0) {
            const insertQuery = `INSERT INTO config (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`;
            await DB.prepare(insertQuery).bind(...insertParams).run();
          }
        }
      }
      
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
  
  return new Response(JSON.stringify({ error: 'Method not supported' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Handle Telegram webhook API
async function handleWebhookAPI(request) {
  if (request.method === 'POST') {
    try {
      const body = await request.json();
      const { action } = body;
      
      if (action === 'set') {
        if (!config.botToken) {
          return new Response(JSON.stringify({ error: 'Bot token is not configured' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        
        const webhookUrl = `${new URL(request.url).origin}/webhook`;
        const telegramResponse = await setTelegramWebhook(webhookUrl);
        
        return new Response(JSON.stringify({ success: true, response: telegramResponse }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } else if (action === 'remove') {
        if (!config.botToken) {
          return new Response(JSON.stringify({ error: 'Bot token is not configured' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        
        const telegramResponse = await removeTelegramWebhook();
        
        return new Response(JSON.stringify({ success: true, response: telegramResponse }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      return new Response(JSON.stringify({ error: 'Invalid action' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
  
  return new Response(JSON.stringify({ error: 'Method not supported' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Handle Telegram webhook
async function handleTelegramWebhook(request) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  
  try {
    const update = await request.json();
    
    // Verify if it's a valid Telegram update
    if (!update || !update.message) {
      return new Response('OK');
    }
    
    const message = update.message;
    const userId = message.from.id.toString();
    
    // Check if user is authorized
    if (config.allowedUsers.length > 0 && !config.allowedUsers.includes(userId)) {
      await sendTelegramMessage(message.chat.id, 'You are not authorized to use this bot.');
      return new Response('OK');
    }
    
    // Handle file uploads
    if (message.photo || message.document || message.video || message.audio) {
      let fileId, fileName, fileType, fileSize;
      
      if (message.photo) {
        // Get the highest resolution photo
        const photo = message.photo[message.photo.length - 1];
        fileId = photo.file_id;
        fileName = `photo_${Date.now()}.jpg`;
        fileType = 'image';
        fileSize = photo.file_size;
      } else if (message.document) {
        fileId = message.document.file_id;
        fileName = message.document.file_name || `document_${Date.now()}`;
        fileType = getFileTypeFromName(fileName);
        fileSize = message.document.file_size;
      } else if (message.video) {
        fileId = message.video.file_id;
        fileName = `video_${Date.now()}.mp4`;
        fileType = 'video';
        fileSize = message.video.file_size;
      } else if (message.audio) {
        fileId = message.audio.file_id;
        fileName = message.audio.file_name || `audio_${Date.now()}.mp3`;
        fileType = 'audio';
        fileSize = message.audio.file_size;
      }
      
      // Process file
      await processFile(fileId, fileName, fileType, fileSize, userId, message.chat.id);
    } else if (message.text === '/start') {
      await sendTelegramMessage(message.chat.id, 'Welcome! Send me photos or files to generate shareable links.');
    } else if (message.text) {
      await sendTelegramMessage(message.chat.id, 'Send photos or files to generate shareable links.');
    }
    
    return new Response('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

// Process uploaded file
async function processFile(fileId, fileName, fileType, fileSize, userId, chatId) {
  try {
    // Get file info from Telegram
    const fileInfo = await getTelegramFileInfo(fileId);
    
    if (!fileInfo || !fileInfo.file_path) {
      await sendTelegramMessage(chatId, 'Error retrieving file information.');
      return;
    }
    
    // Generate public URLs
    const baseUrl = new URL(WORKER_URL).origin;
    const fileUrl = `${baseUrl}/file/${fileId}`;
    const thumbnailUrl = fileType === 'image' ? `${baseUrl}/thumb/${fileId}` : null;
    
    // Store file metadata in DB
    const fileData = {
      telegram_file_id: fileId,
      file_name: fileName,
      file_type: fileType,
      file_size: fileSize || fileInfo.file_size,
      file_path: fileInfo.file_path,
      upload_date: new Date().toISOString(),
      user_id: userId,
      file_url: fileUrl,
      thumbnail_url: thumbnailUrl
    };
    
    await storeFileMetadata(fileData);
    
    // Send response to user
    let message = `File uploaded successfully!\n\n`;
    message += `📄 Filename: ${fileName}\n`;
    message += `🔗 Direct Link: ${fileUrl}\n`;
    
    await sendTelegramMessage(chatId, message);
  } catch (error) {
    console.error('Process file error:', error);
    await sendTelegramMessage(chatId, 'An error occurred while processing your file.');
  }
}

// Store file metadata in database
async function storeFileMetadata(fileData) {
  const query = `
    INSERT INTO files 
    (telegram_file_id, file_name, file_type, file_size, file_path, upload_date, user_id, file_url, thumbnail_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  
  await DB.prepare(query).bind(
    fileData.telegram_file_id,
    fileData.file_name,
    fileData.file_type,
    fileData.file_size,
    fileData.file_path,
    fileData.upload_date,
    fileData.user_id,
    fileData.file_url,
    fileData.thumbnail_url
  ).run();
}

// Get file type from file name
function getFileTypeFromName(fileName) {
  const extension = fileName.split('.').pop().toLowerCase();
  
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'];
  const videoExts = ['mp4', 'avi', 'mov', 'mkv', 'webm'];
  const audioExts = ['mp3', 'wav', 'ogg', 'm4a', 'flac'];
  const docExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt'];
  
  if (imageExts.includes(extension)) return 'image';
  if (videoExts.includes(extension)) return 'video';
  if (audioExts.includes(extension)) return 'audio';
  if (docExts.includes(extension)) return 'document';
  
  return 'other';
}

// Telegram API functions
async function sendTelegramMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML'
    })
  });
  
  return response.json();
}

async function getTelegramFileInfo(fileId) {
  const url = `https://api.telegram.org/bot${config.botToken}/getFile?file_id=${fileId}`;
  const response = await fetch(url);
  const data = await response.json();
  
  if (!data.ok) {
    throw new Error(`Telegram API error: ${data.description}`);
  }
  
  return data.result;
}

async function setTelegramWebhook(webhookUrl) {
  const url = `https://api.telegram.org/bot${config.botToken}/setWebhook`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      url: webhookUrl
    })
  });
  
  return response.json();
}

async function removeTelegramWebhook() {
  const url = `https://api.telegram.org/bot${config.botToken}/deleteWebhook`;
  const response = await fetch(url);
  return response.json();
}

async function deleteTelegramFile(fileId) {
  // Note: Telegram doesn't provide a direct way to delete files
  // This is a placeholder function; implementing proper cleanup would require storing
  // files elsewhere with deletion capabilities
  return true;
}

// Serve files from Telegram
async function serveFile(request, fileId) {
  try {
    // Get file info from database
    const fileStatement = await DB.prepare('SELECT * FROM files WHERE telegram_file_id = ?').bind(fileId);
    const file = await fileStatement.first();
    
    if (!file) {
      return new Response('File not found', { status: 404 });
    }
    
    // Get file from Telegram
    const telegramUrl = `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`;
    const response = await fetch(telegramUrl);
    
    if (!response.ok) {
      return new Response('File not available', { status: 404 });
    }
    
    // Set appropriate content type
    const contentType = getContentTypeFromFileType(file.file_type, file.file_name);
    
    // Stream the file
    return new Response(response.body, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${file.file_name}"`,
        'Cache-Control': 'public, max-age=604800' // Cache for 1 week
      }
    });
  } catch (error) {
    console.error('Serve file error:', error);
    return new Response('Error serving file', { status: 500 });
  }
}

// Serve thumbnail
async function serveThumbnail(request, fileId) {
  try {
    // Get file info from database
    const fileStatement = await DB.prepare('SELECT * FROM files WHERE telegram_file_id = ?').bind(fileId);
    const file = await fileStatement.first();
    
    if (!file) {
      return new Response('Thumbnail not found', { status: 404 });
    }
    
    if (file.file_type !== 'image') {
      // For non-images, return a generic icon based on type
      return serveGenericThumbnail(file.file_type);
    }
    
    // For images, get the file from Telegram but resize if possible
    const telegramUrl = `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`;
    const response = await fetch(telegramUrl);
    
    if (!response.ok) {
      return serveGenericThumbnail(file.file_type);
    }
    
    // Return the image as thumbnail
    // In production, consider implementing proper image resizing here
    return new Response(response.body, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=604800' // Cache for 1 week
      }
    });
  } catch (error) {
    console.error('Serve thumbnail error:', error);
    return serveGenericThumbnail('other');
  }
}

// Serve a generic thumbnail based on file type
function serveGenericThumbnail(fileType) {
  // This is a simplified implementation
  // In production, you would use real icons for different file types
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
    <rect width="100" height="100" fill="#${getColorForFileType(fileType)}" />
    <text x="50" y="50" font-family="Arial" font-size="14" fill="white" text-anchor="middle" dominant-baseline="middle">
      ${fileType.toUpperCase()}
    </text>
  </svg>`;
  
  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=604800' // Cache for 1 week
    }
  });
}

// Get color for file type
function getColorForFileType(fileType) {
  switch (fileType) {
    case 'image': return '3498db';
    case 'video': return 'e74c3c';
    case 'audio': return '2ecc71';
    case 'document': return 'f39c12';
    default: return '7f8c8d';
  }
}

// Get content type from file type
function getContentTypeFromFileType(fileType, fileName) {
  if (fileType === 'image') {
    const extension = fileName.split('.').pop().toLowerCase();
    switch (extension) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'gif':
        return 'image/gif';
      case 'webp':
        return 'image/webp';
      default:
        return 'image/jpeg';
    }
  } else if (fileType === 'video') {
    const extension = fileName.split('.').pop().toLowerCase();
    switch (extension) {
      case 'mp4':
        return 'video/mp4';
      case 'webm':
        return 'video/webm';
      case 'ogg':
        return 'video/ogg';
      default:
        return 'video/mp4';
    }
  } else if (fileType === 'audio') {
    const extension = fileName.split('.').pop().toLowerCase();
    switch (extension) {
      case 'mp3':
        return 'audio/mpeg';
      case 'ogg':
        return 'audio/ogg';
      case 'wav':
        return 'audio/wav';
      default:
        return 'audio/mpeg';
    }
  } else if (fileType === 'document') {
    const extension = fileName.split('.').pop().toLowerCase();
    switch (extension) {
      case 'pdf':
        return 'application/pdf';
      case 'doc':
      case 'docx':
        return 'application/msword';
      case 'xls':
      case 'xlsx':
        return 'application/vnd.ms-excel';
      case 'ppt':
      case 'pptx':
        return 'application/vnd.ms-powerpoint';
      case 'txt':
        return 'text/plain';
      default:
        return 'application/octet-stream';
    }
  }
  
  return 'application/octet-stream';
}

// Fetch Bing background image for UI
async function getBingBackgroundImage() {
  try {
    const bingUrl = 'https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=en-US';
    const response = await fetch(bingUrl);
    const data = await response.json();
    
    if (data.images && data.images.length > 0) {
      const imageUrl = 'https://www.bing.com' + data.images[0].url;
      const imageResponse = await fetch(imageUrl);
      
      return new Response(imageResponse.body, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=86400' // Cache for 1 day
        }
      });
    }
    
    throw new Error('No image found');
  } catch (error) {
    // Return a fallback image or error
    return new Response('Background image not available', { status: 404 });
  }
}

// Render admin interface
function renderAdminInterface() {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Telegram File Manager</title>
      <style>
        /* Paste CSS here from [CSS] section */
      </style>
    </head>
    <body>
      <div id="app">
        <!-- HTML content here from [HTML] section -->
      </div>
      
      <script>
        // Paste JavaScript here for client-side functionality
        document.addEventListener('DOMContentLoaded', () => {
          // App state
          const state = {
            isAuthenticated: false,
            token: localStorage.getItem('token'),
            files: [],
            pagination: {
              page: 1,
              limit: 10,
              total: 0,
              totalPages: 0
            },
            settings: {
              botToken: '',
              allowedUsers: [],
              adminUsername: '',
              webhookUrl: ''
            }
          };
          
          // DOM elements
          const adminPanel = document.getElementById('admin-panel');
          const loginPanel = document.getElementById('login-panel');
          const loadingOverlay = document.getElementById('loading-overlay');
          const loginForm = document.getElementById('login-form');
          const usernameDisplay = document.getElementById('username');
          const logoutBtn = document.getElementById('logout-btn');
          const filesTab = document.getElementById('files-tab');
          const settingsTab = document.getElementById('settings-tab');
          const tabButtons = document.querySelectorAll('.tab-btn');
          const filesList = document.getElementById('files-list');
          const searchInput = document.getElementById('search-input');
          const filterType = document.getElementById('filter-type');
          const pagination = document.getElementById('pagination');
          const botSettingsForm = document.getElementById('bot-settings-form');
          const adminSettingsForm = document.getElementById('admin-settings-form');
          const setWebhookBtn = document.getElementById('set-webhook-btn');
          
          // Check authentication
          const checkAuth = async () => {
            if (!state.token) {
              showLoginPanel();
              return;
            }
            
            try {
              // Validate token by making a request to the API
              const response = await fetch('/api/settings', {
                headers: {
                  'Authorization': 'Bearer ' + state.token
                }
              });
              
              if (response.ok) {
                const data = await response.json();
                state.settings = data;
                state.isAuthenticated = true;
                usernameDisplay.textContent = state.settings.adminUsername;
                showAdminPanel();
                loadFiles();
                populateSettings();
              } else {
                // Token invalid
                localStorage.removeItem('token');
                state.token = null;
                state.isAuthenticated = false;
                showLoginPanel();
              }
            } catch (error) {
              console.error('Auth check failed:', error);
              localStorage.removeItem('token');
              state.token = null;
              state.isAuthenticated = false;
              showLoginPanel();
            }
          };
          
          // UI Functions
          const showLoginPanel = () => {
            adminPanel.style.display = 'none';
            loginPanel.style.display = 'flex';
          };
          
          const showAdminPanel = () => {
            loginPanel.style.display = 'none';
            adminPanel.style.display = 'block';
          };
          
          const showLoading = () => {
            loadingOverlay.style.display = 'flex';
          };
          
          const hideLoading = () => {
            loadingOverlay.style.display = 'none';
          };
          
          const switchTab = (tabId) => {
            // Hide all tabs
            document.querySelectorAll('.tab-content').forEach(tab => {
              tab.style.display = 'none';
            });
            
            // Remove active class from all tab buttons
            tabButtons.forEach(btn => {
              btn.classList.remove('active');
            });
            
            // Show selected tab
            document.getElementById(tabId + '-tab').style.display = 'block';
            
            // Add active class to selected tab button
            document.querySelector(`.tab-btn[data-tab="${tabId}"]`).classList.add('active');
          };
          
          // API Functions
          const loadFiles = async (page = 1, search = '', type = 'all') => {
            showLoading();
            try {
              const url = new URL('/api/files', window.location.origin);
              url.searchParams.append('page', page);
              url.searchParams.append('limit', state.pagination.limit);
              
              if (search) {
                url.searchParams.append('search', search);
              }
              
              if (type !== 'all') {
                url.searchParams.append('type', type);
              }
              
              const response = await fetch(url, {
                headers: {
                  'Authorization': 'Bearer ' + state.token
                }
              });
              
              if (response.ok) {
                const data = await response.json();
                state.files = data.files;
                state.pagination = data.pagination;
                renderFiles();
                renderPagination();
              } else {
                console.error('Failed to load files');
              }
            } catch (error) {
              console.error('Load files error:', error);
            } finally {
              hideLoading();
            }
          };
          
          const deleteFile = async (fileId) => {
            if (!confirm('Are you sure you want to delete this file?')) {
              return;
            }
            
            showLoading();
            try {
              const response = await fetch('/api/files', {
                method: 'DELETE',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': 'Bearer ' + state.token
                },
                body: JSON.stringify({ fileId })
              });
              
              if (response.ok) {
                // Reload files
                loadFiles(state.pagination.page);
              } else {
                alert('Failed to delete file');
              }
            } catch (error) {
              console.error('Delete file error:', error);
              alert('Error deleting file');
            } finally {
              hideLoading();
            }
          };
          
          const setWebhook = async () => {
            showLoading();
            try {
              const response = await fetch('/api/webhook', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': 'Bearer ' + state.token
                },
                body: JSON.stringify({ action: 'set' })
              });
              
              if (response.ok) {
                alert('Webhook set successfully!');
              } else {
                const data = await response.json();
                alert(`Failed to set webhook: ${data.error}`);
              }
            } catch (error) {
              console.error('Set webhook error:', error);
              alert('Error setting webhook');
            } finally {
              hideLoading();
            }
          };
          
          const saveSettings = async (formData) => {
            showLoading();
            try {
              const response = await fetch('/api/settings', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': 'Bearer ' + state.token
                },
                body: JSON.stringify(formData)
              });
              
              if (response.ok) {
                alert('Settings saved successfully!');
                return true;
              } else {
                const data = await response.json();
                alert(`Failed to save settings: ${data.error}`);
                return false;
              }
            } catch (error) {
              console.error('Save settings error:', error);
              alert('Error saving settings');
              return false;
            } finally {
              hideLoading();
            }
          };
          
          const populateSettings = () => {
            document.getElementById('webhook-url').value = state.settings.webhookUrl;
            document.getElementById('allowed-users').value = state.settings.allowedUsers.join(',');
            document.getElementById('admin-username').value = state.settings.adminUsername;
          };
          
          // Render Functions
          const renderFiles = () => {
            if (!state.files || state.files.length === 0) {
              filesList.innerHTML = '<tr><td colspan="6">No files found</td></tr>';
              return;
            }
            
            filesList.innerHTML = state.files.map(file => {
              const date = new Date(file.upload_date).toLocaleString();
              const fileSize = formatFileSize(file.file_size);
              const thumbnailUrl = file.thumbnail_url || '/thumb/' + file.telegram_file_id;
              
              return `
                <tr>
                  <td>
                    ${file.file_type === 'image' ? 
                      `<img src="${thumbnailUrl}" class="file-thumbnail" alt="Thumbnail">` : 
                      `<div class="file-icon ${file.file_type}-icon"></div>`}
                  </td>
                  <td>${file.file_name}</td>
                  <td>${fileSize}</td>
                  <td>${file.file_type}</td>
                  <td>${date}</td>
                  <td>
                    <button class="action-btn" onclick="window.open('${file.file_url}', '_blank')">View</button>
                    <button class="action-btn" onclick="navigator.clipboard.writeText('${file.file_url}').then(() => alert('URL copied!'))">Copy URL</button>
                    <button class="action-btn delete-btn" onclick="window.deleteFile('${file.id}')">Delete</button>
                  </td>
                </tr>
              `;
            }).join('');
          };
          
          const renderPagination = () => {
            if (state.pagination.totalPages <= 1) {
              pagination.innerHTML = '';
              return;
            }
            
            let paginationHTML = '';
            
            // Previous button
            if (state.pagination.page > 1) {
              paginationHTML += `<button class="page-btn" data-page="${state.pagination.page - 1}">Previous</button>`;
            }
            
            // Page numbers
            for (let i = 1; i <= state.pagination.totalPages; i++) {
              if (
                i === 1 || 
                i === state.pagination.totalPages || 
                (i >= state.pagination.page - 2 && i <= state.pagination.page + 2)
              ) {
                paginationHTML += `<button class="page-btn ${i === state.pagination.page ? 'active' : ''}" data-page="${i}">${i}</button>`;
              } else if (
                (i === state.pagination.page - 3) || 
                (i === state.pagination.page + 3)
              ) {
                paginationHTML += `<span>...</span>`;
              }
            }
            
            // Next button
            if (state.pagination.page < state.pagination.totalPages) {
              paginationHTML += `<button class="page-btn" data-page="${state.pagination.page + 1}">Next</button>`;
            }
            
            pagination.innerHTML = paginationHTML;
            
            // Add event listeners to pagination buttons
            document.querySelectorAll('.page-btn').forEach(btn => {
              btn.addEventListener('click', () => {
                const page = parseInt(btn.dataset.page);
                state.pagination.page = page;
                loadFiles(page, searchInput.value, filterType.value);
              });
            });
          };
          
          // Helper Functions
          const formatFileSize = (bytes) => {
            if (!bytes) return '0 Bytes';
            const k = 1024;
            const sizes = ['Bytes', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
          };
          
          // Event Listeners
          loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            
            if (!username || !password) {
              document.getElementById('login-error').textContent = 'Please enter username and password';
              return;
            }
            
            showLoading();
            try {
              const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
              });
              
              if (response.ok) {
                const data = await response.json();
                localStorage.setItem('token', data.token);
                state.token = data.token;
                checkAuth();
              } else {
                const data = await response.json();
                document.getElementById('login-error').textContent = data.error || 'Login failed';
              }
            } catch (error) {
              console.error('Login error:', error);
              document.getElementById('login-error').textContent = 'An error occurred during login';
            } finally {
              hideLoading();
            }
          });
          
          logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('token');
            state.token = null;
            state.isAuthenticated = false;
            showLoginPanel();
          });
          
          tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
              switchTab(btn.dataset.tab);
            });
          });
          
          searchInput.addEventListener('input', debounce(() => {
            state.pagination.page = 1;
            loadFiles(1, searchInput.value, filterType.value);
          }, 500));
          
          filterType.addEventListener('change', () => {
            state.pagination.page = 1;
            loadFiles(1, searchInput.value, filterType.value);
          });
          
          setWebhookBtn.addEventListener('click', setWebhook);
          
          botSettingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = {
              botToken: document.getElementById('bot-token').value,
              allowedUsers: document.getElementById('allowed-users').value
            };
            
            await saveSettings(formData);
          });
          
          adminSettingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const adminUsername = document.getElementById('admin-username').value;
            const adminPassword = document.getElementById('admin-password').value;
            const adminConfirmPassword = document.getElementById('admin-confirm-password').value;
            
            if (adminPassword && adminPassword !== adminConfirmPassword) {
              alert('Passwords do not match!');
              return;
            }
            
            const formData = {
              adminUsername,
              adminPassword: adminPassword || undefined
            };
            
            const success = await saveSettings(formData);
            if (success) {
              document.getElementById('admin-password').value = '';
              document.getElementById('admin-confirm-password').value = '';
            }
          });
          
          function debounce(func, delay) {
            let timeout;
            return function() {
              const context = this;
              const args = arguments;
              clearTimeout(timeout);
              timeout = setTimeout(() => func.apply(context, args), delay);
            };
          }
          
          // Expose functions to window for inline handlers
          window.deleteFile = deleteFile;
          
          // Initialize
          checkAuth();
        });
      </script>
    </body>
    </html>
  `;
}
