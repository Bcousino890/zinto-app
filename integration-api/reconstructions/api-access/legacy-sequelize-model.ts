/**
 * Source-compatible Sequelize model for the recovered Express CRM.
 *
 * The recovered project uses sequelize-typescript and camelCase attributes.
 * Keep this file as the single model definition to re-apply after a rebuild;
 * the database column names are mapped explicitly to the integration schema.
 */
export const legacyApiKeyModelSource = String.raw`import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  AutoIncrement,
  Default,
  DataType
} from "sequelize-typescript";

@Table({ tableName: "api_keys" })
class ApiKey extends Model<ApiKey> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @Column({ field: "company_id", type: DataType.INTEGER })
  companyId: number;

  @Column({ field: "user_id", type: DataType.INTEGER })
  userId: number;

  @Column
  name: string;

  @Column({ field: "key_hash", type: DataType.STRING(64) })
  keyHash: string;

  @Column({ field: "key_prefix", type: DataType.STRING(32) })
  keyPrefix: string;

  @Default([])
  @Column({ type: DataType.JSONB })
  permissions: string[];

  @Default(true)
  @Column({ field: "is_active", type: DataType.BOOLEAN })
  isActive: boolean;

  @Column({ field: "expires_at", type: DataType.DATE })
  expiresAt: Date | null;

  @Column({ field: "allowed_ips", type: DataType.JSONB })
  allowedIps: string[] | null;

  @Default({})
  @Column({ type: DataType.JSONB })
  metadata: Record<string, unknown>;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default ApiKey;`;

export const legacyApiKeyRegistration =
  'import ApiKey from "../models/ApiKey";\n// Add ApiKey to the models array passed to sequelize.addModels(models).';

export const legacyApiKeyRouteRegistration =
  'routes.use("/api/settings", apiKeyRoutes);\n// Mount after the normal session-protected settings routes.';
