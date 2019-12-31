#!/usr/bin/env node
'use strict'

const express = require('express')
const winston = require('winston')
var btoa = require('btoa');
var mongoose = require('mongoose');
mongoose.connect('mongodb://127.0.0.1:27017/trackerclean');
var Schema=mongoose.Schema;
var defaultDate=new Date('2018-10-01');
var entityPagerSchema=Schema({
	orgId:String,
	programStageId:String,
	pageCount:String, 
	current:{type:Number,default:1},
	endDate:Date,
	startDate:Date
});
var eventPagerSchema=Schema({
	orgId:String,
	pageCount:String, 
	current:{type:Number,default:1},
	endDate:Date,
	startDate:Date
});
var stagePagerSchema=Schema({
	orgId:String,
	stageId:String,
	pageCount:String, 
	current:{type:Number,default:1},
	endDate:Date,
	startDate:Date
});


var entityPagerSchemaDefinition=mongoose.model('entityPager',entityPagerSchema);
var eventPagerSchemaDefinition=mongoose.model('enventPager',eventPagerSchema);
var stagePagerSchemaDefinition=mongoose.model('enventStagePager',stagePagerSchema);
// Logging setup
winston.remove(winston.transports.Console)
winston.add(winston.transports.Console, {level: 'info', timestamp: true, colorize: true})

// Config
var config = {} // this will vary depending on whats set in openhim-core
const appConfig = require('../config/config')

var port = appConfig.endPoint.port
const baseUrlAPI=appConfig.dhis.baseUrlAPI;
const basicClientToken = `Basic ${btoa( appConfig.dhis.username+':'+ appConfig.dhis.password)}`;

/**
 * setupApp - configures the http server for this mediator
 *
 * @return {express.App}  the configured http server
 */
 function errorHandler(err, req, res, next) {
		  if (res.headersSent) {
			return next(err);
		  }
		  res.status(500);
		  res.render('error', { error: err });
	}


function setupApp () {
	
  const app = express()
  app.use(errorHandler);
  //
  var async = require('async');
  app.get('/attribute2stage', (req, res) => {
	  //console.log("entered to the call");
	var needle = require('needle');
	needle.defaults(
	{
		open_timeout: 600000
	});
	getPager(appConfig.programStage.parentOrgUnit,appConfig.programStage.startDate,appConfig.programStage.endDate,
		function(pagerEntity){
		//console.log(pager);
		//return;
		
		var currentPageEntity=0;
		if(pagerEntity!=null)
		{
			currentPageEntity=pagerEntity.current;
		}
		getPagerEvent(appConfig.programStage.parentOrgUnit,appConfig.programStage.startDate,appConfig.programStage.endDate,
			function(pagerEvent){
				var globalEventsList=[];
			var globalEntitiesList=[];
			var currentPageEvent=0;
			if(pagerEvent!=null)
			{
				currentPageEvent=pagerEvent.current;
			}

			getEventsByPeriod(0,appConfig.programStage.startDate,appConfig.programStage.endDate,appConfig.programStage.programStageId,
				appConfig.programStage.parentOrgUnit,appConfig.programStage.pageSize,globalEventsList,function(eventsList){
					console.log("Events:"+eventsList.length);
					//now get the list of trackedEntities
					getTrackedEntities(currentPageEntity,appConfig.programStage.programId,appConfig.programStage.parentOrgUnit,appConfig.programStage.pageSize,globalEntitiesList
						,function(entitiesList){
							console.log("Tracked entities:"+entitiesList.length);
							//return;
							winston.info("--------Start the process of refactoring the concerned events------");
							var listEventsToUpdate=refactorEventsWithAttributeValues(entitiesList,eventsList,
								appConfig.programStage.dataElementToTransfert);
							winston.info("--------End of refactoring------");
							winston.info("Nbre of Event to update :"+listEventsToUpdate.length);
							//console.log(listEventsToUpdate[2]);
							//Now build orchestration for async request
							var orchestrationList=[];
							for(var index=0;index<listEventsToUpdate.length;index++)
							{
								orchestrationList.push({
									ref:listEventsToUpdate[index].event,
									name:listEventsToUpdate[index].event,
									domain:appConfig.dhis.baseUrlAPI,
									path:"/events/"+listEventsToUpdate[index].event,
									params: "",
									body:JSON.stringify(listEventsToUpdate[index]),
									method: "PUT",
									headers: {'Content-Type': 'application/json','Authorization': basicClientToken}
								});
							}
							//console.log(orchestration[2]);
							var async = require('async');
							var ctxObject2Update = []; 
							var orchestrationsResults=[];
							var counterPush=1;
							async.each(orchestrationList, function(orchestration, callbackUpdate) {
								var orchUrl = orchestration.domain + orchestration.path + orchestration.params;
								var options={headers:orchestration.headers};
								var envent2Push=orchestration.body;
								needle.put(orchUrl,envent2Push,options, function(err, resp) {
									if ( err ){
										winston.error("Needle: error when pushing event to dhis2");
										callbackUpdate(err);
									}
									console.log("********************************************************");
									winston.info(counterPush+"/"+orchestrationList.length);
									winston.info("...Inserting "+orchestration.path);
									orchestrationsResults.push({
										name: orchestration.name,
										request: {
										  path : orchestration.path,
										  headers: orchestration.headers,
										  querystring: orchestration.params,
										  body: orchestration.body,
										  method: orchestration.method,
										  timestamp: new Date().getTime()
										},
										response: {
										  status: resp.statusCode,
										  //body: JSON.stringify(resp.body.toString('utf8'), null, 4),
										  body: resp.body,
										  timestamp: new Date().getTime()
										}
										});
									winston.info("-------Response from DHIS2------");
									winston.info(resp.body)
									counterPush++;
									callbackUpdate();
								})//end of needle post
							},function(err){
								if(err)
								{
									winston.error(err);
								}
								winston.info("update of events in dhis2!");
								winston.info("End of event update orchestration");
								res.send(orchestrationsResults);
							}//end of function(err)
							);//end of aysnc 
		
						})//end of getTrackedEntities
				});//end of getEventsByPeriod

			})//end of getPagerEvent

		
  
	});//end of getPager
	 
  });//end of get attribute2stage

  app.get('/attribut2estage2', (req, res) => {
	var needle = require('needle');
	needle.defaults(
	{
		open_timeout: 600000
	});
	getPager(appConfig.programStage.parentOrgUnit,appConfig.programStage.programStageId,appConfig.programStage.startDate,appConfig.programStage.endDate,
		function(pagerEntity){
			var currentPageEntity=0;
			var globalEntitiesList=[];
			if(pagerEntity!=null)
			{
				currentPageEntity=pagerEntity.current;
				winston.info("Entity current page: " +currentPageEntity+"/"+pagerEntity.pageCount);
			}
			
			getTrackedEntities(currentPageEntity,appConfig.programStage.programId,appConfig.programStage.parentOrgUnit,appConfig.programStage.pageSize,globalEntitiesList
				,function(entitiesList){
					winston.info("Nbre of entities to process: "+entitiesList.length);
					winston.info("Start the orcheastration to get the entities related events");
					var eventOrchestratorList=[];
					for(var i=0;i<entitiesList.length;i++)
					{
						eventOrchestratorList.push(
							{
								ref:entitiesList[i].trackedEntityInstance,
								name:entitiesList[i].trackedEntityInstance,
								domain:appConfig.dhis.baseUrlAPI,
								path:"/events.json?orgUnit="+entitiesList[i].orgUnit+"&programStage="+appConfig.programStage.programStageId+"&trackedEntityInstance="+entitiesList[i].trackedEntityInstance+"&skipPaging=true",
								body:entitiesList[i].attributes,
								method:"GET",
								headers: {'Content-Type': 'application/json','Authorization': basicClientToken}
							}
						)
					}
					//console.log(eventOrchestrator[0])
					var async = require('async');
					var orchestrationsResults=[];
					var counterGet=1;
					async.each(eventOrchestratorList, function(eventOrcherstrator, callbackGet) {
						var orchUrl = eventOrcherstrator.domain + eventOrcherstrator.path ;
						var options={headers:eventOrcherstrator.headers};
						needle.get(orchUrl,options, function(err, resp) {
							if ( err ){
								winston.error(err);
							}
							console.log("***************************************");
							winston.info(counterGet+"/"+eventOrchestratorList.length);
							winston.info("...getting: "+eventOrcherstrator.path);
							orchestrationsResults.push({
								name: eventOrcherstrator.name,
								request: {
								  path : eventOrcherstrator.path,
								  headers: eventOrcherstrator.headers,
								  querystring: eventOrcherstrator.params,
								  body: eventOrcherstrator.body,
								  method: eventOrcherstrator.method,
								  timestamp: new Date().getTime()
								},
								response: {
								  status: resp.statusCode,
								  body: resp.body,
								  timestamp: new Date().getTime()
								}
							});
							counterGet++;
							callbackGet();
						});//end of needle
						
					},
					function(err)
					{
						if(err)
						{
							winston.error(err);
						}
						winston.info("Get all related events entities instance: done!");
						winston.info("------------Refactor event to add attribute-------------");
						var  listEventToUpdate=[];
						//console.log(orchestrationsResults[0].response.body.events);
						for(var indexOrch=0;indexOrch<orchestrationsResults.length;indexOrch++)
						{
							var eventRes=refactorEventsWithAttributeValues2(orchestrationsResults[indexOrch].request.body,
								orchestrationsResults[indexOrch].response.body.events[0],appConfig.programStage.dataElementToTransfert);
							if(eventRes!=null)
							{
								listEventToUpdate.push(eventRes);
							}
						}
						
						//console.log(JSON.stringify(listEventToUpdate));
						//res.send(listEventToUpdate);
						winston.info("------------End of refactoring--------------");
						winston.info("Nbre of event to update: "+listEventToUpdate.length);
						var orchestrationList=[];
						for(var index=0;index<listEventToUpdate.length;index++)
						{
							orchestrationList.push({
								ref:listEventToUpdate[index].event,
								name:listEventToUpdate[index].event,
								domain:appConfig.dhis.baseUrlAPI,
								path:"/events/"+listEventToUpdate[index].event,
								params: "",
								body:JSON.stringify(listEventToUpdate[index]),
								method: "PUT",
								headers: {'Content-Type': 'application/json','Authorization': basicClientToken}
							});
						}
						var asyncUpdate = require('async');
						var orchestrationsUpdateResults=[];
						var counterPush=1; 
						asyncUpdate.each(orchestrationList, function(orchestration, callbackUpdate) {
							var orchUrl = orchestration.domain + orchestration.path + orchestration.params;
							var options={headers:orchestration.headers};
							var envent2Push=orchestration.body;
							needle.put(orchUrl,envent2Push,options, function(err, resp) {
								if ( err ){
									winston.error("Needle: error when pushing event to dhis2");
									callbackUpdate(err);
								}
								console.log("********************************************************");
								winston.info(counterPush+"/"+orchestrationList.length);
								winston.info("...Inserting "+orchestration.path);
								orchestrationsResults.push({
									name: orchestration.name,
									request: {
									  path : orchestration.path,
									  headers: orchestration.headers,
									  querystring: orchestration.params,
									  body: orchestration.body,
									  method: orchestration.method,
									  timestamp: new Date().getTime()
									},
									response: {
									  status: resp.statusCode,
									  //body: JSON.stringify(resp.body.toString('utf8'), null, 4),
									  body: resp.body,
									  timestamp: new Date().getTime()
									}
									});
								winston.info("-------Response from DHIS2------");
								winston.info(resp.body)
								counterPush++;
								callbackUpdate();
							})//end of needle post

						},function(err){
							if(err)
							{
								winston.error(err);
							}
							winston.info("update of events in dhis2!");
							winston.info("End of event update orchestration");
							res.send({"updatedEvents": orchestrationsResults.length});

						});//end of asyncUpdate
						
					})//end of asynch each orcherstrationList
					//return;
				})//end of getTrackedEntities
			
		})//end of getPager
  });//edn of attribut2estage2
  
  app.get('/lockevents', (req, res) => {
	var needle = require('needle');
	needle.defaults(
	{
		open_timeout: 600000
	});
	getPagerEventStage(appConfig.dataToLock.parentOrgUnit,appConfig.dataToLock.programStageId,
		appConfig.dataToLock.startDate,appConfig.programStage.endDate,
		function(pagerEvent){
			var currentPageEvent=0;
			var globalEventsList=[];
			//console.log(pagerEvent);
			if(pagerEvent!=null)
			{
				currentPageEvent=pagerEvent.current;
				winston.info("Entity current page: " +currentPageEvent+"/"+pagerEvent.pageCount);
			}
			
			getStageEventsByPeriod(currentPageEvent,appConfig.dataToLock.startDate,appConfig.dataToLock.endDate,
				appConfig.dataToLock.programStageId,appConfig.dataToLock.parentOrgUnit,appConfig.dataToLock.pageSize,
				globalEventsList,function(eventsList){
					winston.info("Get all related events instance: done!");
					winston.info("------------Refactor events to set status to complete-------------");
					var listEventsToComplete=refactorEventsToCompletedStatus(eventsList);
					winston.info("------------End of refactor------------");
					winston.info("Nbre of event to complete: "+listEventsToComplete.length);
					var orchestrationList=[];
					for(var index=0;index<listEventsToComplete.length;index++)
					{
						orchestrationList.push({
							ref:listEventsToComplete[index].event,
							name:listEventsToComplete[index].event,
							domain:appConfig.dhis.baseUrlAPI,
							path:"/events/"+listEventsToComplete[index].event,
							params: "",
							body:JSON.stringify(listEventsToComplete[index]),
							method: "PUT",
							headers: {'Content-Type': 'application/json','Authorization': basicClientToken}
						});
					}
					var asyncUpdate = require('async');
					var orchestrationsResults=[];
					var counterPush=1; 
					asyncUpdate.each(orchestrationList, function(orchestration, callbackUpdate) {
						var orchUrl = orchestration.domain + orchestration.path + orchestration.params;
						var options={headers:orchestration.headers};
						var envent2Push=orchestration.body;
							needle.put(orchUrl,envent2Push,options, function(err, resp) {
								if ( err ){
									winston.error("Needle: error when pushing event to dhis2");
									callbackUpdate(err);
								}
								console.log("********************************************************");
								winston.info(counterPush+"/"+orchestrationList.length);
								winston.info("...Inserting "+orchestration.path);
								orchestrationsResults.push({
									name: orchestration.name,
									request: {
									  path : orchestration.path,
									  headers: orchestration.headers,
									  querystring: orchestration.params,
									  body: orchestration.body,
									  method: orchestration.method,
									  timestamp: new Date().getTime()
									},
									response: {
									  status: resp.statusCode,
									  //body: JSON.stringify(resp.body.toString('utf8'), null, 4),
									  body: resp.body,
									  timestamp: new Date().getTime()
									}
									});
								winston.info("-------Response from DHIS2------");
								winston.info(resp.body)
								counterPush++;
								callbackUpdate();
							})//end of needle post
					},function(err){
						if(err)
						{
							winston.error(err);
						}
						winston.info("update of events in dhis2!");
						winston.info("End of event update orchestration");
						res.send({"updatedEvents": orchestrationsResults.length});
					});//end of asyncUpdate 
					

				});//end of getStageEventsByPeriod
		})//end of getPager
  });//edn of attribut2estage2
  app.get('/unlockevents', (req, res) => {
	var needle = require('needle');
	needle.defaults(
	{
		open_timeout: 600000
	});
	getPagerEventStage(appConfig.dataToLock.parentOrgUnit,appConfig.dataToLock.programStageId,
		appConfig.dataToLock.startDate,appConfig.programStage.endDate,
		function(pagerEvent){
			var currentPageEvent=0;
			var globalEventsList=[];
			//console.log(pagerEvent);
			if(pagerEvent!=null)
			{
				currentPageEvent=pagerEvent.current;
				winston.info("Entity current page: " +currentPageEvent+"/"+pagerEvent.pageCount);
			}
			
			getStageEventsByPeriod(currentPageEvent,appConfig.dataToLock.startDate,appConfig.dataToLock.endDate,
				appConfig.dataToLock.programStageId,appConfig.dataToLock.parentOrgUnit,appConfig.dataToLock.pageSize,
				globalEventsList,function(eventsList){
					winston.info("Get all related events instance: done!");
					winston.info("------------Refactor events to set status to active-------------");
					var listEventsToComplete=refactorEventsToActiveStatus(eventsList);
					winston.info("------------End of refactor------------");
					winston.info("Nbre of event to activated: "+listEventsToComplete.length);
					var orchestrationList=[];
					for(var index=0;index<listEventsToComplete.length;index++)
					{
						orchestrationList.push({
							ref:listEventsToComplete[index].event,
							name:listEventsToComplete[index].event,
							domain:appConfig.dhis.baseUrlAPI,
							path:"/events/"+listEventsToComplete[index].event,
							params: "",
							body:JSON.stringify(listEventsToComplete[index]),
							method: "PUT",
							headers: {'Content-Type': 'application/json','Authorization': basicClientToken}
						});
					}
					var asyncUpdate = require('async');
					var orchestrationsResults=[];
					var counterPush=1; 
					asyncUpdate.each(orchestrationList, function(orchestration, callbackUpdate) {
						var orchUrl = orchestration.domain + orchestration.path + orchestration.params;
						var options={headers:orchestration.headers};
						var envent2Push=orchestration.body;
							needle.put(orchUrl,envent2Push,options, function(err, resp) {
								if ( err ){
									winston.error("Needle: error when pushing event to dhis2");
									callbackUpdate(err);
								}
								console.log("********************************************************");
								winston.info(counterPush+"/"+orchestrationList.length);
								winston.info("...Inserting "+orchestration.path);
								orchestrationsResults.push({
									name: orchestration.name,
									request: {
									  path : orchestration.path,
									  headers: orchestration.headers,
									  querystring: orchestration.params,
									  body: orchestration.body,
									  method: orchestration.method,
									  timestamp: new Date().getTime()
									},
									response: {
									  status: resp.statusCode,
									  //body: JSON.stringify(resp.body.toString('utf8'), null, 4),
									  body: resp.body,
									  timestamp: new Date().getTime()
									}
									});
								winston.info("-------Response from DHIS2------");
								winston.info(resp.body)
								counterPush++;
								callbackUpdate();
							})//end of needle post
					},function(err){
						if(err)
						{
							winston.error(err);
						}
						winston.info("update of events in dhis2!");
						winston.info("End of event update orchestration");
						res.send({"updatedEvents": orchestrationsResults.length});
					});//end of asyncUpdate 
					

				});//end of getStageEventsByPeriod
		})//end of getPager
  });//edn of attribut2estage2
  app.get('/convertevent2adx', (req, res) => {
	var needle = require('needle');
	needle.defaults(
	{
		open_timeout: 600000
	});
	var currentPageEvent=0;
	var globalEventsList=[];
	getStageEventsByPeriod(currentPageEvent,appConfig.adxEvent.startDate,appConfig.adxEvent.endDate,
		appConfig.adxEvent.stageId,appConfig.adxEvent.orgId,1000,
		globalEventsList,function(eventsList){
			
		});

  });//end app.get convertevent2adx
    
	
  return app 
}
//return generated Indicators from event
function generateDataElementsFromEvents(eventsList)
{
	var indicators2GenerateList=appConfig.adxEvent.Indicators;
	for(var index=0;index<eventsList.length;index++)
	{
		//check the event condition

	}
}
function generateKPPrevDataElements(eventsList){
	for(var index=0;index<eventsList.length;index++)
	{
		var oEvent=eventsList[index];
		for(var indexValues=0;indexValues<oEvent.dataValues.length;indexValues++)
		{
			
		}
	}
	
}
//return the of the events program filter by startDate and endDate

function getEventsByPeriod(currentPage,startDate,endDate,programStage,parentOrgUnit,pageSize,globalEventsList,callback)
{
	var urlRequest="";
	if(currentPage==0)
	{
		//console.log("First Iteration");
		urlRequest=`${baseUrlAPI}/events.json?orgUnit=${parentOrgUnit}&ouMode=CHILDREN&programStage=${programStage}&startDate=${startDate}&endDate=${endDate}&pageSize=${pageSize}&totalPages=true&page=1`;
		console.log(urlRequest);
	
	}
	else{
		//console.log("Other iteration");
		urlRequest=`${baseUrlAPI}/events.json?orgUnit=${parentOrgUnit}&ouMode=CHILDREN&programStage=${programStage}&startDate=${startDate}&endDate=${endDate}&pageSize=${pageSize}&totalPages=true&page=${currentPage}`;
		//console.log("------------------------------");
		winston.info(urlRequest);
	}
	
	
	var needle = require('needle');
	needle.defaults(
	{
		open_timeout: 600000
	});
	var headers= {'Content-Type': 'application/json','Authorization': basicClientToken};
	var options={headers:headers};
	needle.get(urlRequest,options, function(err, resp) {
		
		if ( err ){
			//winston.error("Error occured while looping through bundle to construct the Fhir Product List");
			winston.error(err);
			callback(err);
		}
		//console.log(resp.statusCode);
		if(resp.statusCode==200)
		{
			//console.log(resp.body.events);
			//var responseBundle=JSON.stringify(resp.body.toString('utf8'));
			//var response=JSON.parse(resp.body);
			
			for(var index=0;index<resp.body.events.length;index++)
			{
				globalEventsList.push(resp.body.events[index]);
			}
			if(resp.body.pager.pageCount>1 && resp.body.pager.page<resp.body.pager.pageCount && globalEventsList.length<appConfig.programStage.nbreEventsToProcess)
			{
				//console.log(resp.body.pager);
				var nextPage=resp.body.pager.page+1;
				getEventsByPeriod(nextPage,startDate,endDate,programStage,parentOrgUnit,pageSize,globalEventsList,callback);

			}
			else
			{
				var nextPage=resp.body.pager.page+1;				
				upDatePagerEvent(parentOrgUnit,appConfig.programStage.startDate,appConfig.programStage.endDate,resp.body.pager.pageCount,nextPage,function(res){
					winston.info("Updated event pager: "+res);
					return callback(globalEventsList);
				})
				//return callback(globalEventsList);
			}
			
		}
		else{
			return [];
		}
	});//end of needle
	
}
function getStageEventsByPeriod(currentPage,startDate,endDate,programStage,parentOrgUnit,pageSize,globalEventsList,callback)
{
	var urlRequest="";
	if(currentPage==0)
	{
		//console.log("First Iteration");
		urlRequest=`${baseUrlAPI}/events.json?orgUnit=${parentOrgUnit}&ouMode=DESCENDANTS&programStage=${programStage}&startDate=${startDate}&endDate=${endDate}&pageSize=${pageSize}&totalPages=true&page=1`;
		console.log(urlRequest);
	
	}
	else{
		//console.log("Other iteration");
		urlRequest=`${baseUrlAPI}/events.json?orgUnit=${parentOrgUnit}&ouMode=DESCENDANTS&programStage=${programStage}&startDate=${startDate}&endDate=${endDate}&pageSize=${pageSize}&totalPages=true&page=${currentPage}`;
		//console.log("------------------------------");
		winston.info(urlRequest);
	}
	
	
	var needle = require('needle');
	needle.defaults(
	{
		open_timeout: 600000
	});
	var headers= {'Content-Type': 'application/json','Authorization': basicClientToken};
	var options={headers:headers};
	needle.get(urlRequest,options, function(err, resp) {
		
		if ( err ){
			//winston.error("Error occured while looping through bundle to construct the Fhir Product List");
			winston.error(err);
			callback(err);
		}
		//console.log(resp.statusCode);
		if(resp.statusCode==200)
		{
			//console.log(resp.body.events);
			//var responseBundle=JSON.stringify(resp.body.toString('utf8'));
			//var response=JSON.parse(resp.body);
			
			for(var index=0;index<resp.body.events.length;index++)
			{
				globalEventsList.push(resp.body.events[index]);
			}
			if(resp.body.pager.pageCount>1 && resp.body.pager.page<resp.body.pager.pageCount && globalEventsList.length<appConfig.dataToLock.nbreEventsToProcess)
			{
				//console.log(resp.body.pager);
				var nextPage=resp.body.pager.page+1;
				getStageEventsByPeriod(nextPage,startDate,endDate,programStage,parentOrgUnit,pageSize,globalEventsList,callback);

			}
			else
			{
				var nextPage=resp.body.pager.page+1;				
				upDatePagerEventStage(parentOrgUnit,programStage,appConfig.programStage.startDate,appConfig.programStage.endDate,resp.body.pager.pageCount,nextPage,function(res){
					winston.info("Updated event pager: "+res);
					return callback(globalEventsList);
				})
				//return callback(globalEventsList);
			}
			
		}
		else{
			return [];
		}
	});//end of needle
	
}
function getTrackedEntities(currentPage,program,parentOrgUnit,pageSize,globalEntitiesList,callback)
{
	var urlRequest="";
	if(currentPage==0)
	{
		//console.log("First Iteration");
		urlRequest=`${baseUrlAPI}/trackedEntityInstances.json?ou=${parentOrgUnit}&ouMode=DESCENDANTS&program=${program}&pageSize=${pageSize}&totalPages=true&page=1&fields=trackedEntityInstance,orgUnit,attributes`;
	
	}
	else{
		//console.log("Other iteration");
		urlRequest=`${baseUrlAPI}/trackedEntityInstances.json?ou=${parentOrgUnit}&ouMode=DESCENDANTS&program=${program}&pageSize=${pageSize}&totalPages=true&page=${currentPage}&fields=trackedEntityInstance,orgUnit,attributes`;
		//console.log("------------------------------");
		console.log(urlRequest);
	}
	
	
	var needle = require('needle');
	needle.defaults(
	{
		open_timeout: 600000
	});
	var headers= {'Content-Type': 'application/json','Authorization': basicClientToken};
	var options={headers:headers};
	needle.get(urlRequest,options, function(err, resp) {
		
		if ( err ){
			//winston.error("Error occured while looping through bundle to construct the Fhir Product List");
			winston.error(err);
			callback(err);
		}
		//console.log(resp.statusCode);
		if(resp.statusCode==200)
		{
			//console.log(resp.body.events);
			//var responseBundle=JSON.stringify(resp.body.toString('utf8'));
			//var response=JSON.parse(resp.body);
			
			for(var index=0;index<resp.body.trackedEntityInstances.length;index++)
			{
				globalEntitiesList.push(resp.body.trackedEntityInstances[index]);
			}
			if(resp.body.pager.pageCount>1 && resp.body.pager.page<resp.body.pager.pageCount && globalEntitiesList.length<appConfig.programStage.nbreTrackerEntityToProcess)
			{
				//console.log(resp.body.pager);
				var nextPage=resp.body.pager.page+1;
				getTrackedEntities(nextPage,program,parentOrgUnit,pageSize,globalEntitiesList,callback)

			}
			else
			{
				var nextPage=resp.body.pager.page+1;
				upDatePager(parentOrgUnit,appConfig.programStage.programStageId,appConfig.programStage.startDate,appConfig.programStage.endDate,resp.body.pager.pageCount,nextPage,function(res){
					winston.info("Updated pager: "+res);
					return callback(globalEntitiesList);
				})
				
			}
			
		}
		else{
			return [];
		}
	});//end of needle
	
}
function refactorEventsWithAttributeValues(entitiesList,eventsList,dataElementsToTransfert)
{
	var ListEventsToProcess=[];
	var numberOfEventWithValue=0;
	for(var indexEvent=0;indexEvent<eventsList.length;indexEvent++)
	{
		//Now search for the corresponding entity
		var itemFound=false;
		
		for(var indexEntity=0;indexEntity<entitiesList.length;indexEntity++)
		{
			if(eventsList[indexEvent].trackedEntityInstance==entitiesList[indexEntity].trackedEntityInstance){
				for(var indexAttribute=0;indexAttribute<entitiesList[indexEntity].attributes.length;indexAttribute++){
					var correspondingDataElement=getDataElementToTransfert(entitiesList[indexEntity].attributes[indexAttribute].attribute,
						dataElementsToTransfert);
						if(correspondingDataElement!="")
						{
							//Check if the event has already a value
							var eventHasValue=checkIfEventHasAlreadyDateElementValue(correspondingDataElement,
								eventsList[indexEvent]);
								//if the event does not contain the correspondingdataElement then assign it to the event
							if(!eventHasValue){
								//
								var attributeValue= entitiesList[indexEntity].attributes[indexAttribute].value;
								var oEvent=eventsList[indexEvent];
								oEvent.dataValues.push({"dataElement":correspondingDataElement,"value":attributeValue});
								//console.log("--------DateElement to add---------------------");
								//console.log({"dataElement":correspondingDataElement,"value":attributeValue});
								ListEventsToProcess.push(oEvent);
							}
							else{
								numberOfEventWithValue++;
							}
						}

				}
			}
		}
	}
	winston.info(numberOfEventWithValue +" events has already element value");
	return ListEventsToProcess;
}
function refactorEventsToCompletedStatus(eventsList)
{
	var ListEventsToProcess=[];
	var numberOfEventWithStatusCompleted=0;
	for(var index=0;index<eventsList.length;index++)
	{
		if(eventsList[index].status=="COMPLETED")
		{
			numberOfEventWithStatusCompleted++;
			continue;
		}
		else
		{
			var oEvent=eventsList[index];
			oEvent.status="COMPLETED";
			ListEventsToProcess.push(oEvent);
		}
	}
	winston.info(numberOfEventWithStatusCompleted +" events has already element value");
	return ListEventsToProcess;
}
function refactorEventsToActiveStatus(eventsList)
{
	var ListEventsToProcess=[];
	var numberOfEventWithStatusCompleted=0;
	for(var index=0;index<eventsList.length;index++)
	{
		if(eventsList[index].status=="ACTIVE")
		{
			numberOfEventWithStatusCompleted++;
			continue;
		}
		else
		{
			var oEvent=eventsList[index];
			oEvent.status="ACTIVE";
			ListEventsToProcess.push(oEvent);
		}
	}
	winston.info(numberOfEventWithStatusCompleted +" events has already element value");
	return ListEventsToProcess;
}
function refactorEventsWithAttributeValues2(entityAttribute,oEvent,dataElementsToTransfert)
{
	var _event=null;
	if(oEvent==null)
	{
		return null;
	}
	for(var indexAttribute=0;indexAttribute<entityAttribute.length;indexAttribute++){
		var correspondingDataElement=getDataElementToTransfert(entityAttribute[indexAttribute].attribute,
			dataElementsToTransfert);
			if(correspondingDataElement!="")
			{
				//Check if the event has already a value
				var eventHasValue=checkIfEventHasAlreadyDateElementValue(correspondingDataElement,
					oEvent);
					//if the event does not contain the correspondingdataElement then assign it to the event
				if(!eventHasValue){
					//
					var attributeValue= entityAttribute[indexAttribute].value;
					_event=oEvent;
					_event.dataValues.push({"dataElement":correspondingDataElement,"value":attributeValue});
				}
				else{
					winston.info(oEvent.event +"  has already element value");
				}
			}

	}
	
	return _event;
}

function getDataElementToTransfert(dataAttribute,dataElementListToTransfert)
{
	var dataElement="";
	for(var i=0;i<dataElementListToTransfert.length;i++)
	{
		if(dataElementListToTransfert[i].attributSource==dataAttribute)
		{
			dataElement=dataElementListToTransfert[i].dataElementDestination;
			break;
		}
	}
	return dataElement;
}
function checkIfEventHasAlreadyDateElementValue(dateElementId,event)
{
	var hasValue=false;
	//console.log(event);
	//winston.info("***************event id to check :"+ event.event);
	for(var i=0;i<event.dataValues.length;i++)
	{
		if(event.dataValues[i].dataElement==dateElementId  )
		{
			if(event.dataValues[i].value!="")
			{
				hasValue=true;
				winston.warn("Event "+event.event+" has "+dateElementId+":"+event.dataValues[i].value);
				break;
			}
			
		}
	}
	return hasValue;
}
var upDatePager=function(orgUnitId,programStageId,startDate,endDate,_pageCount,_currentPage,callback)
{
	var _startDate=new Date(startDate);
	var _endDate=new Date(endDate);
	
	var res=entityPagerSchemaDefinition.findOneAndUpdate({"orgId":orgUnitId,"programStageId":programStageId,"startDate":_startDate,"endDate":_endDate},{$set:{pageCount:_pageCount,current:_currentPage,"startDate":_startDate,"endDate":_endDate}},{upsert:true},(err, doc) => {
		if (err) {
			//console.log(err);
			console.log("Error: Failed to update the entitypager record!");
			callback(false);
		}
		else
		{
			callback(true);
		}})
}
var upDatePagerEvent=function(orgUnitId,startDate,endDate,_pageCount,_currentPage,callback)
{
	var _startDate=new Date(startDate);
	var _endDate=new Date(endDate);
	
	var res=eventPagerSchemaDefinition.findOneAndUpdate({"orgId":orgUnitId,"startDate":_startDate,"endDate":_endDate},{$set:{pageCount:_pageCount,current:_currentPage,"startDate":_startDate,"endDate":_endDate}},{upsert:true},(err, doc) => {
		if (err) {
			//console.log(err);
			console.log("Error: Failed to update the eventpager record!");
			callback(false);
		}
		else
		{
			callback(true);
		}})
}
var upDatePagerEventStage=function(orgUnitId,programStageId,startDate,endDate,_pageCount,_currentPage,callback)
{
	var _startDate=new Date(startDate);
	var _endDate=new Date(endDate);
	
	var res=stagePagerSchemaDefinition.findOneAndUpdate({"orgId":orgUnitId,"stageId":programStageId},
	{$set:{pageCount:_pageCount,current:_currentPage}},{upsert:true},(err, doc) => {
		if (err) {
			//console.log(err);
			console.log("Error: Failed to update the eventpager record!");
			callback(false);
		}
		else
		{
			callback(true);
		}})
}
var getPager=function(orgUnitId,programStageId,startDate,endDate,callback)
{
	var _startDate=new Date(startDate);
	var _endDate=new Date(endDate);
	var requestResult=entityPagerSchemaDefinition.findOne({"orgId":orgUnitId,"programStageId":programStageId,"startDate":_startDate,"endDate":_endDate},{"_id":0}).exec(function(error,doc){
		if(error) {
			console.log("Error: Failed to get pager log record!");
			callback (null);
		}
		else
		{
			callback(doc);
		}
		
		});
}
var getPagerEvent=function(orgUnitId,startDate,endDate,callback)
{
	var _startDate=new Date(startDate);
	var _endDate=new Date(endDate);
	var requestResult=eventPagerSchemaDefinition.findOne({"orgId":orgUnitId,"startDate":_startDate,"endDate":_endDate},{"_id":0}).exec(function(error,doc){
		if(error) {
			console.log("Error: Failed to get event pager log record!");
			callback (null);
		}
		else
		{
			callback(doc);
		}
		
		});
}
var getPagerEventStage=function(orgUnitId,programStageId,startDate,endDate,callback)
{
	//console.log(orgUnitId+","+programStageId+","+startDate+","+endDate);
	var _startDate=new Date(startDate);
	var _endDate=new Date(endDate);
	var requestResult=stagePagerSchemaDefinition.findOne({"orgId":orgUnitId,"stageId":programStageId},{"_id":0}).exec(function(error,doc){
		if(error) {
			console.log("Error: Failed to get event pager log record!");
			callback (null);
		}
		else
		{
			//console.log(doc);
			callback(doc);
		}
		
		});
}
/**
 * start - starts the mediator
 *
 * @param  {Function} callback a node style callback that is called once the
 * server is started
 */
function start (callback) {
  
	let app = setupApp()
    const server = app.listen(port, () => callback(server))

}
exports.start = start

if (!module.parent) {
  // if this script is run directly, start the server
  start(() => winston.info(`Listening on ${port}...`))
}
