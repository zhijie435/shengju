module.exports = {
  apps: [{
    name: 'sjrcw-api',
    script: '/data/apps/sjrcw/backend/server.js',
    instances: 4,
    exec_mode: 'cluster',
    cwd: '/data/apps/sjrcw/backend',
    env: {
      NODE_ENV: 'production',
      SMS_BYPASS: 'true',
      UV_THREADPOOL_SIZE: '32'
    },
    max_memory_restart: '1500M',
    error_file: '/var/log/sjrcw/error.log',
    out_file: '/var/log/sjrcw/out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    watch: false,
    kill_timeout: 5000,
    listen_timeout: 10000,
  }]
};
