web: ts-node -P tsconfig.node.json -T server.ts
worker: NODE_OPTIONS=--max_old_space_size=4096 RUN_AS_LISTENER=true ts-node --log-error --project tsconfig.node.json server.ts
release: npx sequelize-cli db:migrate --config server/sequelize.json