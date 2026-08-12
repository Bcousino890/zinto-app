for file in /www/wwwroot/default/migrations/*.sql; do
  echo "Running $file..."
  docker exec -i powerchat-postgres psql -U postgres -d powerchat < "$file"
done
