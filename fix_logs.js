const fs = require('fs');

// Read the file
let content = fs.readFileSync('src/services/baileysService.ts', 'utf8');

// Replace all log.error calls with error objects to string concatenation
content = content.replace(
  /this\.fastify\.log\.error\('([^']+)',\s*([^)]+)\)/g,
  "this.fastify.log.error('$1: ' + ($2 instanceof Error ? $2.message : String($2)))"
);

content = content.replace(
  /this\.fastify\.log\.warn\('([^']+)',\s*([^)]+)\)/g,
  "this.fastify.log.warn('$1: ' + ($2 instanceof Error ? $2.message : String($2)))"
);

// Replace log.info calls with objects to string concatenation
content = content.replace(
  /this\.fastify\.log\.info\('([^']+)',\s*\{([^}]+)\}\)/gs,
  (match, message, objectContent) => {
    // Extract key-value pairs from the object
    const pairs = objectContent.split(',').map(line => line.trim()).filter(line => line);
    const stringPairs = pairs.map(pair => {
      const [key, value] = pair.split(':').map(s => s.trim());
      return `${key}=\${${value}}`;
    });
    return `this.fastify.log.info('${message}: ${stringPairs.join(', ')}')`;
  }
);

// Fix socket.end() calls
content = content.replace(/session\.socket\.end\(\)/g, 'session.socket.end(undefined)');

// Write back the file
fs.writeFileSync('src/services/baileysService.ts', content);
console.log('Fixed logging issues in baileysService.ts');
