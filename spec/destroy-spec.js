/*global describe, require, it, expect, beforeEach, console */
const underTest = require('../src/commands/destroy'),
	create = require('../src/commands/create'),
	shell = require('shelljs'),
	retriableWrap = require('../src/util/retriable-wrap'),
	tmppath = require('../src/util/tmppath'),
	fs = require('fs'),
	path = require('path'),
	aws = require('aws-sdk'),
	awsRegion = require('./util/test-aws-region');
describe('destroy', () => {
	'use strict';
	let workingdir, testRunName, newObjects, iam;
	beforeEach(() => {
		workingdir = tmppath();
		testRunName = 'test' + Date.now();
		iam = new aws.IAM();
		newObjects = { workingdir: workingdir };
		shell.mkdir(workingdir);
	});
	it('fails when the source dir does not contain the project config file', done => {
		underTest({ source: workingdir })
		.then(done.fail, reason => expect(reason).toEqual('claudia.json does not exist in the source folder'))
		.then(done);
	});
	it('fails when the project config file does not contain the lambda name', done => {
		fs.writeFileSync(path.join(workingdir, 'claudia.json'), '{}', 'utf8');
		underTest({ source: workingdir })
		.then(done.fail, reason => expect(reason).toEqual('invalid configuration -- lambda.name missing from claudia.json'))
		.then(done);
	});
	it('fails when the project config file does not contain the lambda region', done => {
		fs.writeFileSync(path.join(workingdir, 'claudia.json'), JSON.stringify({ lambda: { name: 'xxx' } }), 'utf8');
		underTest({ source: workingdir })
		.then(done.fail, reason => expect(reason).toEqual('invalid configuration -- lambda.region missing from claudia.json'))
		.then(done);
	});
	describe('when only a lambda function exists', () => {
		beforeEach(done => {
			shell.cp('-r', 'spec/test-projects/hello-world/*', workingdir);
			create({ name: testRunName, region: awsRegion, source: workingdir, handler: 'main.handler' })
			.then(result => {
				newObjects.lambdaFunction = result.lambda && result.lambda.name;
				newObjects.lambdaRole = result.lambda && result.lambda.role;
			})
			.then(done, done.fail);
		});
		it('destroys the lambda function', done => {
			underTest({ source: workingdir })
			.then(() => {
				const lambda = new aws.Lambda({ region: awsRegion });
				return lambda.listVersionsByFunction({ FunctionName: testRunName }).promise();
			})
			.catch(expectedException => expect(expectedException.message).toContain(newObjects.lambdaFunction))
			.then(done, done.fail);
		});
		it('destroys the roles for the lambda function', done => {
			underTest({ source: workingdir })
			.then(() => iam.getRole({ RoleName: newObjects.lambdaRole }).promise())
			.catch(expectedException => expect(expectedException.code).toEqual('NoSuchEntity'))
			.then(done, done.fail);
		});
		it('destroys the policies for the lambda function', done => {
			underTest({ source: workingdir })
			.then(() => iam.listRolePolicies({ RoleName: newObjects.lambdaRole }).promise())
			.catch(expectedException => expect(expectedException.message).toContain(newObjects.lambdaRole))
			.then(done, done.fail);
		});
	});
	describe('removing the config file', () => {
		beforeEach(done => {
			shell.cp('-r', 'spec/test-projects/hello-world/*', workingdir);
			create({ name: testRunName, region: awsRegion, source: workingdir, handler: 'main.handler' })
			.then(result => {
				newObjects.lambdaFunction = result.lambda && result.lambda.name;
				newObjects.lambdaRole = result.lambda && result.lambda.role;
			})
			.then(done, done.fail);
		});
		it('removes claudia.json if --config is not provided', done => {
			underTest({ source: workingdir })
			.then(() => expect(shell.test('-e', path.join(workingdir, 'claudia.json'))).toBeFalsy())
			.then(done, done.fail);
		});
		it('removes specified config if --config is provided', done => {
			const otherPath = tmppath();
			shell.cp(path.join(workingdir, 'claudia.json'), otherPath);
			underTest({ source: workingdir, config: otherPath})
			.then(() => {
				expect(shell.test('-e', path.join(workingdir, 'claudia.json'))).toBeTruthy();
				expect(shell.test('-e', path.join(workingdir, otherPath))).toBeFalsy();
			})
			.then(done, e => {
				console.log(e.stack || e.message || e);
				done.fail(e);
			});
		});
	});
	describe('when the lambda project contains a web api', () => {
		beforeEach(done => {
			shell.cp('-r', 'spec/test-projects/api-gw-hello-world/*', workingdir);
			create({ name: testRunName, region: awsRegion, source: workingdir, 'api-module': 'main' })
			.then(result => {
				newObjects.lambdaRole = result.lambda && result.lambda.role;
				newObjects.lambdaFunction = result.lambda && result.lambda.name;
				newObjects.restApi = result.api && result.api.id;
			})
			.then(done, done.fail);
		});
		it('destroys the lambda function', done => {
			underTest({ source: workingdir })
			.then(() => {
				const lambda = new aws.Lambda({ region: awsRegion });
				return lambda.listVersionsByFunction({ FunctionName: testRunName }).promise();
			})
			.catch(expectedException => expect(expectedException.message).toContain(newObjects.lambdaFunction))
			.then(done, done.fail);
		});

		it('destroys the web api', done => {
			underTest({ source: workingdir })
			.then(() => {
				const apiGateway = retriableWrap(new aws.APIGateway({ region: awsRegion }));
				return apiGateway.getRestApi({ restApiId: newObjects.restApi }).promise();
			})
			.catch(expectedException => {
				expect(expectedException.message).toEqual('Invalid REST API identifier specified');
				expect(expectedException.code).toEqual('NotFoundException');
			})
			.then(done, done.fail);
		});
		it('destroys the roles for the lambda function', done => {
			underTest({ source: workingdir })
			.then(() => iam.getRole({ RoleName: newObjects.lambdaRole }).promise())
			.catch(expectedException => expect(expectedException.code).toEqual('NoSuchEntity'))
			.then(done, done.fail);
		});
		it('destroys the policies for the lambda function', done => {
			underTest({ source: workingdir })
			.then(() => iam.listRolePolicies({ RoleName: newObjects.lambdaRole }).promise())
			.catch(expectedException => expect(expectedException.message).toContain(newObjects.lambdaRole))
			.then(done, done.fail);
		});
	});
});
