import {Global, Module} from "@nestjs/common";
import {TypeOrmModule} from "@nestjs/typeorm";

import {buildDataSourceOptions} from "./data-source-options";
import {ENTITIES} from "./entities";

const rootModule = TypeOrmModule.forRootAsync({useFactory: () => buildDataSourceOptions()});
const featureModule = TypeOrmModule.forFeature(ENTITIES);

/**
 * Global TypeORM wiring: the shared `DataSource` and every repository are
 * available application-wide without re-importing `TypeOrmModule.forFeature`.
 */
@Global()
@Module({
    imports: [rootModule, featureModule],
    exports: [rootModule, featureModule],
})
export class DatabaseModule {}
