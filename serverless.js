'use strict';

const ensureIterable = require('type/iterable/ensure');
const ensurePlainObject = require('type/plain-object/ensure');
const ensureString = require('type/string/ensure');
const random = require('ext/string/random');
const path = require('path');
const { Component, utils } = require('@serverless/core');

module.exports = class TencentHapi extends Component {
    getDefaultProtocol(protocols) {
        if (protocols.map((i) => i.toLowerCase()).includes('https')) {
          return 'https'
        }
        return 'http'
    }

    async default(inputs = {}) {
        inputs.name =
            ensureString(inputs.functionName, { isOptional: true }) ||
            this.state.functionName ||
            `HapiComponent_${random({ length: 6 })}`;
        inputs.codeUri = ensureString(inputs.code, { isOptional: true }) || process.cwd();
        inputs.region = ensureString(inputs.region, { default: 'ap-guangzhou' });
        inputs.include = ensureIterable(inputs.include, { default: [], ensureItem: ensureString });
        inputs.exclude = ensureIterable(inputs.exclude, { default: [], ensureItem: ensureString });
        const apigatewayConf = ensurePlainObject(inputs.apigatewayConf, { default: {} });

        if (!(await utils.fileExists(path.resolve(inputs.codeUri, 'app.js')))) {
            throw new Error(`app.js not found in ${inputs.codeUri}`);
        }

        inputs.exclude.push('.git/**', '.gitignore', '.serverless', '.DS_Store');

        const filePath = path.resolve(__dirname, 'lambda.js');
        const tencentHapiPath = path.resolve(__dirname, 'tencent-cloud-hapi.js');
        inputs.include.push(filePath);
        inputs.include.push(tencentHapiPath);
        inputs.handler = 'lambda.handler';
        inputs.runtime = 'Nodejs8.9';

        const tencentCloudFunction = await this.load('@serverless/tencent-scf');
        if (inputs.functionConf) {
            inputs.timeout = inputs.functionConf.timeout || 3;
            inputs.memorySize = inputs.functionConf.memorySize || 128;
            if (inputs.functionConf.environment) inputs.environment = inputs.functionConf.environment;
            if (inputs.functionConf.vpcConfig) inputs.vpcConfig = inputs.functionConf.vpcConfig;
        }

        inputs.fromClientRemark = inputs.fromClientRemark || 'tencent-hapi';
        const tencentCloudFunctionOutputs = await tencentCloudFunction(inputs);

        const outputs = {
            region: inputs.region,
            functionName: inputs.name,
        };

        // if not disable, then create apigateway
        if (!apigatewayConf.isDisabled) {
            const tencentApiGateway = await this.load('@serverless/tencent-apigateway');
            const apigwParam = {
                serviceName: inputs.serviceName,
                description: 'Serverless Framework tencent-hapi Component',
                serviceId: inputs.serviceId,
                region: inputs.region,
                protocols: apigatewayConf.protocols || ['http'],
                environment: apigatewayConf.environment || 'release',
                endpoints: [
                    {
                        path: '/',
                        method: 'ANY',
                        function: {
                            isIntegratedResponse: true,
                            functionName: tencentCloudFunctionOutputs.Name,
                        },
                    },
                ],
                customDomain: apigatewayConf.customDomain,
            };
            if (apigatewayConf.usagePlan) apigwParam.endpoints[0].usagePlan = apigatewayConf.usagePlan;
            if (apigatewayConf.auth) apigwParam.endpoints[0].auth = inputs.apigatewayConf.auth;
    
            apigwParam.fromClientRemark = inputs.fromClientRemark || 'tencent-hapi';
            const tencentApiGatewayOutputs = await tencentApiGateway(apigwParam);
            outputs.apiGatewayServiceId = tencentApiGatewayOutputs.serviceId;
            outputs.url = `${this.getDefaultProtocol(tencentApiGatewayOutputs.protocols)}://${
                tencentApiGatewayOutputs.subDomain
            }/${tencentApiGatewayOutputs.environment}/`;

            if (tencentApiGatewayOutputs.customDomains) {
                outputs.customDomains = tencentApiGatewayOutputs.customDomains;
            }
        }
        
        this.state.functionName = inputs.name;
        await this.save();

        return outputs;
    }

    async remove(inputs = {}) {
        const removeInput = {
            fromClientRemark: inputs.fromClientRemark || 'tencent-hapi'
        };
        const tencentApiGateway = await this.load('@serverless/tencent-apigateway');
        const tencentCloudFunction = await this.load('@serverless/tencent-scf');

        await tencentApiGateway.remove(removeInput);
        await tencentCloudFunction.remove(removeInput);

        return {};
    }
};
