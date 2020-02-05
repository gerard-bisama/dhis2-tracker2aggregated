#!/usr/bin/env node
'use strict'

//const { refactorEventsWithAttributeValues2 } = require("./refactorEventsWithAttributeValues2");

const express = require('express')
const winston = require('winston')
const moment = require('moment')
var xml = require('xml');
var btoa = require('btoa');
const alasql=require('alasql')
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
var adxPagerSchema=Schema({
	orgId:String,
	stageId:String,
	endDate:Date,
	startDate:Date,
	incrementDate:Date,
	incrementDays:Date
});

var entityPagerSchemaDefinition=mongoose.model('entityPager',entityPagerSchema);
var eventPagerSchemaDefinition=mongoose.model('enventPager',eventPagerSchema);
var stagePagerSchemaDefinition=mongoose.model('enventStagePager',stagePagerSchema);
var adxPagerSchemaDefinition=mongoose.model('adxPagerSchema',adxPagerSchema);
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
  app.get('/testgroupby', (req, res) => {
	var data=[ 
		{ "category" : "Search Engines", "hits" : 5, "bytes" : 50189 },
		{ "category" : "Content Server", "hits" : 1, "bytes" : 17308 },
		{ "category" : "Content Server", "hits" : 1, "bytes" : 47412 },
		{ "category" : "Search Engines", "hits" : 1, "bytes" : 7601 },
		{ "category" : "Business", "hits" : 1, "bytes" : 2847 },
		{ "category" : "Content Server", "hits" : 1, "bytes" : 24210 },
		{ "category" : "Internet Services", "hits" : 1, "bytes" : 3690 },
		{ "category" : "Search Engines", "hits" : 6, "bytes" : 613036 },
		{ "category" : "Search Engines", "hits" : 1, "bytes" : 2858 } 
	   ];
	   var result = alasql('SELECT category, sum(hits) AS hits, sum(bytes) as bytes \
		FROM ? \
		GROUP BY category \
		ORDER BY bytes DESC',[data]);
	console.log(result);
	res.send(result);
  });
  app.get('/delattr2stagepager', (req, res) => {
	reinitEntityPager(function(result){
		if(result)
		{
			winston.warn("Attribute2stage pager collection deleted successfully ")
		}
		else{
			winston.warn("Failed to delete pager collection successfully ")
		}
		res.send("{'res':1}");
	})
	
  });
  app.get('/deladxpager', (req, res) => {
	reinitAdxPager(function(result){
		if(result)
		{
			winston.warn("Adx pager collection deleted successfully ")
		}
		else{
			winston.warn("Failed to delete adx pager collection successfully ")
		}
		res.send("{'res':1}");
	})
	
  });
  app.get('/deleventpager', (req, res) => {
	reinitEventPager(function(result){
		if(result)
		{
			winston.warn("Event lock pager collection deleted successfully ")
		}
		else{
			winston.warn("Failed to delete Event lock pager collection successfully ")
		}
		res.send("{'res':1}");
	})
	
  });

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
								//path:"/events.json?orgUnit="+entitiesList[i].orgUnit+"&programStage="+appConfig.programStage.programStageId+"&trackedEntityInstance="+entitiesList[i].trackedEntityInstance+"&skipPaging=true",
								path:"/events.json?programStage="+appConfig.programStage.programStageId+"&trackedEntityInstance="+entitiesList[i].trackedEntityInstance+"&skipPaging=true",
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
							winston.warn("Index :"+indexOrch);
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
  app.get('/convertevent2adx/:id', (req, res) => {
	var needle = require('needle');
	needle.defaults(
	{
		open_timeout: 600000
	});
	var currentPageEvent=0;
	var globalEventsList=[];
	//console.log(req.params.id);
	if(req.params.id =="")
	{
		res.send("Invalide params");
	}
	var dataElementScheme=req.params.id.toUpperCase();
	
	var dataElementSchemeDefinition= getKpPrevDataDefinition(dataElementScheme);
	//console.log(dataElementSchemeDefinition);


	getAdxPager(appConfig.adxEvent.orgId,dataElementSchemeDefinition.stageId,appConfig.adxEvent.startDate,appConfig.adxEvent.endDate,
		function(adxPager)
		{
			

			var incrementDays=appConfig.adxEvent.incrementDays;
			var startDate=appConfig.adxEvent.startDate;
			var endDate=appConfig.adxEvent.endDate;
			var _incrementDate;
			var _startDate;
			//console.log(adxPager);
			if(adxPager==null)
			{
				_startDate=startDate;
				var incrementTempDate=moment(startDate).add(incrementDays,'days');
				_incrementDate=incrementTempDate.format('YYYY-MM-DD');
			}
			else
			{
				//_startDate=adxPager.startDate;
				_startDate=moment(adxPager.startDate).format('YYYY-MM-DD');
				var incrementTempDate=moment(_startDate).add(incrementDays,'days');
				_incrementDate=incrementTempDate.format('YYYY-MM-DD');
				var dateBefore=new Date(_startDate);
				var dateEnd=new Date(appConfig.adxEvent.endDate);
				if(dateBefore>=dateEnd)
				{
					_incrementDate=appConfig.adxEvent.endDate;
					_startDate=appConfig.adxEvent.endDate;
					console.log("Date is overdue!!!");
				}
			}
			/*console.log(_startDate);
			console.log(_incrementDate);*/
			//return;
			getStageEventsByPeriodSkipPaging(_startDate,appConfig.adxEvent.endDate,
				_incrementDate,dataElementSchemeDefinition.stageId,appConfig.adxEvent.orgId,globalEventsList,function(eventsList){
			var listADxPayLoad=[];
			if(dataElementSchemeDefinition.name=="PREV")
			{
				listADxPayLoad=generateAdxKPPREVFromEvents(eventsList,dataElementSchemeDefinition);
			}
			else if(dataElementSchemeDefinition.name=="TEST")
			{
				listADxPayLoad=generateAdxHTTSTFromEvents(eventsList,dataElementSchemeDefinition)
			}
			else if(dataElementSchemeDefinition.name=="POS")
			{
				listADxPayLoad=generateAdxHTSPOSFromEvents(eventsList,dataElementSchemeDefinition)
			}
			else if(dataElementSchemeDefinition.name=="POS1")
			{
				listADxPayLoad=generateAdxHTSPOS1FromEvents(eventsList,dataElementSchemeDefinition)
			}
			else if(dataElementSchemeDefinition.name=="LINKNEW")
			{
				listADxPayLoad=generateAdxTXLinkNewFromEvents(eventsList,dataElementSchemeDefinition)
			}
			//console.log(listADxPayLoad);
			//return;
			var orchestrationsADX2Push=[];
			for(var iteratorADX=0;iteratorADX<listADxPayLoad.length;iteratorADX++)
			{
				orchestrationsADX2Push.push(
				{ 
					ctxObjectRef: "adx"+iteratorADX,
					name: "adx"+iteratorADX,
					domain:  appConfig.dhis.baseUrlAPI,
					path:"/dataValueSets?dataElementIdScheme=UID&orgUnitIdScheme=UID",
					params: "",
					body:listADxPayLoad[iteratorADX],
					method: "POST",
					headers: {'Content-Type': 'application/adx+xml','Authorization': basicClientToken}
				});
			}
			var async = require('async');
			var ctxObject2Update = []; 
			var orchestrationsResults=[];
			var counterPush=1;
			async.each(orchestrationsADX2Push, function(orchestration, callbackUpdate) {
				var orchUrl = orchestration.domain + orchestration.path + orchestration.params;
				var options={headers:orchestration.headers};
				var adx2Push=orchestration.body;
				needle.post(orchUrl,adx2Push,options, function(err, resp) {
					if ( err ){
						winston.error("Needle: error when pushing event to dhis2");
						callbackUpdate(err);
					}
					console.log("********************************************************");
					winston.info(counterPush+"/"+orchestrationsADX2Push.length);
					winston.info("...Inserting "+orchestration.path);
					orchestrationsResults.push({
						name: orchestration.name,
						request: {
						  path : orchestration.path,
						  headers: orchestration.headers,
						  querystring: orchestration.params,
						  body: orchestration.body,
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
				winston.info("Adx payload pushed  in dhis2!");
				winston.info("End of event update orchestration");
				//res.send(orchestrationsResults.length);
				res.send({"status":"OK"});
			}//end of function(err)
			);//end of aysnc 
				})//end of getStageEventsByPeriodSkipPaging
		})//end of getAdxPager
	
  });//end app.get convertevent2adx
    
	
  return app 
}
//return generated KP_PREV DataElement  from event
function generateAdxKPPREVFromEvents(eventsList,dataElementSchemeDefinition)
{
	var listAdxPayLoad=[];
	var indicators2GenerateList=appConfig.adxEvent.Indicators;
	winston.info("totalList of events: "+eventsList.length);
	var listEventKPPrev=generateKPPrevDataElements(eventsList,dataElementSchemeDefinition);
	winston.info("Total list of kpprev event: "+listEventKPPrev.length);
	var nbrOfEventsByDate=[];
	var reformatedList=[];
	for(var index=0;index<listEventKPPrev.length;index++)
	{
		var oEvent=listEventKPPrev[index];
		var aggregatedValue=getAggregatedDataElementValues(oEvent,dataElementSchemeDefinition);
		reformatedList.push({
			id:oEvent.event,
			eventDate:oEvent.eventDate.split("T")[0],
			orgUnit:oEvent.orgUnit,
			sexe:aggregatedValue.sexe,
			categorieKeyPop:aggregatedValue.categorieKeyPop,
			groupAge:aggregatedValue.groupAge
			//partenaireExecution:aggregatedValue.partenaireExecution

		})
	}
	//console.log(reformatedList[0]);
	/*var listTemp=[];
	for(var index=0;index<reformatedList.length;index++)
	{
		if(reformatedList[index].groupAge=="15-19" && reformatedList[index].sexe=='F')
		{
			//console.log(result[index]);
			listTemp.push(reformatedList[index]);
		}
		else
		{
			continue;
		}
	}
	console.log(listTemp);*/
	//now group the event to get number by category
	if(reformatedList.length>0)
	{
		/*var result = alasql('SELECT count(id) as nbre,eventDate,orgUnit,sexe,categorieKeyPop,groupAge,partenaireExecution \
		FROM ? \
		GROUP BY eventDate,orgUnit,sexe,categorieKeyPop,groupAge,partenaireExecution \
		ORDER BY eventDate DESC',[reformatedList]);*/
		var result = alasql('SELECT count(id) as nbre,eventDate,orgUnit,sexe,categorieKeyPop,groupAge \
		FROM ? \
		GROUP BY eventDate,orgUnit,sexe,categorieKeyPop,groupAge \
		ORDER BY eventDate DESC',[reformatedList]);
	//console.log(result);
	var count=0;
	var result2=[];
	for(var index=0;index<result.length;index++)
	{
		if(result[index].categorieKeyPop=="PS")
		{
			count+=result[index].nbre;
			result2.push(result[index]);
			
		}
		
	}
	winston.info("Total after compilation :"+count);
	var kpPrevDateDefinition=dataElementSchemeDefinition;
	//console.log(result);
	
	/*var listTemp=[];
	for(var index=0;index<result.length;index++)
	{
		if(result[index].groupAge=="15-19" && result[index].sexe=='F')
		{
			//console.log(result[index]);
			listTemp.push(result[index]);
		}
		else
		{
			continue;
		}
	}
	console.log(listTemp);*/
	//return;
	//listAdxPayLoad=conver2adx(result,kpPrevDateDefinition.dataElementId);
	/*console.log("------------------------------------");
	console.log(result);*/
	listAdxPayLoad=conver2adx(result,kpPrevDateDefinition.dataElementId,kpPrevDateDefinition.dataSetId);
	//listAdxPayLoad=conver2adx(result2,kpPrevDateDefinition.dataElementId,kpPrevDateDefinition.dataSetId);
	}
	
	//listAdxPayLoad=conver2adx(listTemp,kpPrevDateDefinition.dataElementId,kpPrevDateDefinition.dataSetId);
	//console.log(listAdxPayLoad);
	return listAdxPayLoad;

	

}
//return generated HT_TEST DataElement  from event
function generateAdxHTTSTFromEvents(eventsList,dataElementSchemeDefinition)
{
	var listAdxPayLoad=[];
	//var indicators2GenerateList=appConfig.adxEvent.Indicators;
	winston.info("totalList of events: "+eventsList.length);
	var listEventKPPrev=generateHTTSTDataElements(eventsList,dataElementSchemeDefinition);
	winston.info("Total list of HT_TST event: "+listEventKPPrev.length);
	var nbrOfEventsByDate=[];
	var reformatedList=[];
	for(var index=0;index<listEventKPPrev.length;index++)
	{
		var oEvent=listEventKPPrev[index];
		var aggregatedValue=getAggregatedDataElementValues(oEvent,dataElementSchemeDefinition);
		reformatedList.push({
			id:oEvent.event,
			eventDate:oEvent.eventDate.split("T")[0],
			orgUnit:oEvent.orgUnit,
			sexe:aggregatedValue.sexe,
			categorieKeyPop:aggregatedValue.categorieKeyPop,
			groupAge:aggregatedValue.groupAge
			//partenaireExecution:aggregatedValue.partenaireExecution

		})
	}
	//console.log(reformatedList[0]);
	/*var listTemp=[];
	for(var index=0;index<reformatedList.length;index++)
	{
		if(reformatedList[index].groupAge=="15-19" && reformatedList[index].sexe=='F')
		{
			//console.log(result[index]);
			listTemp.push(reformatedList[index]);
		}
		else
		{
			continue;
		}
	}
	console.log(listTemp);*/
	//now group the event to get number by category
	if(reformatedList.length>0)
	{
		/*var result = alasql('SELECT count(id) as nbre,eventDate,orgUnit,sexe,categorieKeyPop,groupAge,partenaireExecution \
		FROM ? \
		GROUP BY eventDate,orgUnit,sexe,categorieKeyPop,groupAge,partenaireExecution \
		ORDER BY eventDate DESC',[reformatedList]);*/
		var result = alasql('SELECT count(id) as nbre,eventDate,orgUnit,sexe,categorieKeyPop,groupAge \
		FROM ? \
		GROUP BY eventDate,orgUnit,sexe,categorieKeyPop,groupAge \
		ORDER BY eventDate DESC',[reformatedList]);
	//console.log(result);
	var count=0;

	for(var index=0;index<result.length;index++)
	{
		count+=result[index].nbre;
	}
	winston.info("Total after compilation :"+count);
	var kpPrevDateDefinition=dataElementSchemeDefinition;
	//console.log(count);
	//return;
	/*var listTemp=[];
	for(var index=0;index<result.length;index++)
	{
		if(result[index].groupAge=="15-19" && result[index].sexe=='F')
		{
			//console.log(result[index]);
			listTemp.push(result[index]);
		}
		else
		{
			continue;
		}
	}
	console.log(listTemp);*/
	//return;
	//listAdxPayLoad=conver2adx(result,kpPrevDateDefinition.dataElementId);
	/*console.log("------------------------------------");
	console.log(result);*/
	listAdxPayLoad=conver2adx(result,kpPrevDateDefinition.dataElementId,kpPrevDateDefinition.dataSetId);
	}
	
	//listAdxPayLoad=conver2adx(listTemp,kpPrevDateDefinition.dataElementId,kpPrevDateDefinition.dataSetId);
	//console.log(listAdxPayLoad);
	return listAdxPayLoad;

	

}
//return generated HTS_POS DataElement  from event
function generateAdxHTSPOSFromEvents(eventsList,dataElementSchemeDefinition)
{
	var listAdxPayLoad=[];
	//var indicators2GenerateList=appConfig.adxEvent.Indicators;
	winston.info("totalList of events: "+eventsList.length);
	var listEventKPPrev=generateHTSPOSDataElements(eventsList,dataElementSchemeDefinition);
	winston.info("Total list of HTS_POS event: "+listEventKPPrev.length);
	var nbrOfEventsByDate=[];
	var reformatedList=[];
	for(var index=0;index<listEventKPPrev.length;index++)
	{
		var oEvent=listEventKPPrev[index];
		var aggregatedValue=getAggregatedDataElementValues(oEvent,dataElementSchemeDefinition);
		reformatedList.push({
			id:oEvent.event,
			eventDate:oEvent.eventDate.split("T")[0],
			orgUnit:oEvent.orgUnit,
			sexe:aggregatedValue.sexe,
			categorieKeyPop:aggregatedValue.categorieKeyPop,
			groupAge:aggregatedValue.groupAge
			//partenaireExecution:aggregatedValue.partenaireExecution

		})
	}
	//console.log(reformatedList[0]);
	/*var listTemp=[];
	for(var index=0;index<reformatedList.length;index++)
	{
		if(reformatedList[index].groupAge=="15-19" && reformatedList[index].sexe=='F')
		{
			//console.log(result[index]);
			listTemp.push(reformatedList[index]);
		}
		else
		{
			continue;
		}
	}
	console.log(listTemp);*/
	//now group the event to get number by category
	if(reformatedList.length>0)
	{
		/*var result = alasql('SELECT count(id) as nbre,eventDate,orgUnit,sexe,categorieKeyPop,groupAge,partenaireExecution \
		FROM ? \
		GROUP BY eventDate,orgUnit,sexe,categorieKeyPop,groupAge,partenaireExecution \
		ORDER BY eventDate DESC',[reformatedList]);*/
		var result = alasql('SELECT count(id) as nbre,eventDate,orgUnit,sexe,categorieKeyPop,groupAge \
		FROM ? \
		GROUP BY eventDate,orgUnit,sexe,categorieKeyPop,groupAge \
		ORDER BY eventDate DESC',[reformatedList]);
	//console.log(result);
	var count=0;

	for(var index=0;index<result.length;index++)
	{
		count+=result[index].nbre;
	}
	winston.info("Total after compilation :"+count);
	var kpPrevDateDefinition=dataElementSchemeDefinition;
	//console.log(count);
	//return;
	/*var listTemp=[];
	for(var index=0;index<result.length;index++)
	{
		if(result[index].groupAge=="15-19" && result[index].sexe=='F')
		{
			//console.log(result[index]);
			listTemp.push(result[index]);
		}
		else
		{
			continue;
		}
	}
	console.log(listTemp);*/
	//return;
	//listAdxPayLoad=conver2adx(result,kpPrevDateDefinition.dataElementId);
	/*console.log("------------------------------------");
	console.log(result);*/
	listAdxPayLoad=conver2adx(result,kpPrevDateDefinition.dataElementId,kpPrevDateDefinition.dataSetId);
	}
	
	//listAdxPayLoad=conver2adx(listTemp,kpPrevDateDefinition.dataElementId,kpPrevDateDefinition.dataSetId);
	//console.log(listAdxPayLoad);
	return listAdxPayLoad;

	

}
function generateAdxHTSPOS1FromEvents(eventsList,dataElementSchemeDefinition)
{
	var listAdxPayLoad=[];
	//var indicators2GenerateList=appConfig.adxEvent.Indicators;
	winston.info("totalList of events: "+eventsList.length);
	var listEventKPPrev=generateHTSPOS1DataElements(eventsList,dataElementSchemeDefinition);
	winston.info("Total list of HTS_POS1 event: "+listEventKPPrev.length);
	var nbrOfEventsByDate=[];
	var reformatedList=[];
	for(var index=0;index<listEventKPPrev.length;index++)
	{
		var oEvent=listEventKPPrev[index];
		var aggregatedValue=getAggregatedDataElementValues(oEvent,dataElementSchemeDefinition);
		reformatedList.push({
			id:oEvent.event,
			eventDate:oEvent.eventDate.split("T")[0],
			orgUnit:oEvent.orgUnit,
			sexe:aggregatedValue.sexe,
			categorieKeyPop:aggregatedValue.categorieKeyPop,
			groupAge:aggregatedValue.groupAge
			//partenaireExecution:aggregatedValue.partenaireExecution

		})
	}
	//console.log(reformatedList[0]);
	/*var listTemp=[];
	for(var index=0;index<reformatedList.length;index++)
	{
		if(reformatedList[index].groupAge=="15-19" && reformatedList[index].sexe=='F')
		{
			//console.log(result[index]);
			listTemp.push(reformatedList[index]);
		}
		else
		{
			continue;
		}
	}
	console.log(listTemp);*/
	//now group the event to get number by category
	if(reformatedList.length>0)
	{
		/*var result = alasql('SELECT count(id) as nbre,eventDate,orgUnit,sexe,categorieKeyPop,groupAge,partenaireExecution \
		FROM ? \
		GROUP BY eventDate,orgUnit,sexe,categorieKeyPop,groupAge,partenaireExecution \
		ORDER BY eventDate DESC',[reformatedList]);*/
		var result = alasql('SELECT count(id) as nbre,eventDate,orgUnit,sexe,categorieKeyPop,groupAge \
		FROM ? \
		GROUP BY eventDate,orgUnit,sexe,categorieKeyPop,groupAge \
		ORDER BY eventDate DESC',[reformatedList]);
	//console.log(result);
	var count=0;

	for(var index=0;index<result.length;index++)
	{
		count+=result[index].nbre;
	}
	winston.info("Total after compilation :"+count);
	var kpPrevDateDefinition=dataElementSchemeDefinition;
	//console.log(count);
	//return;
	/*var listTemp=[];
	for(var index=0;index<result.length;index++)
	{
		if(result[index].groupAge=="15-19" && result[index].sexe=='F')
		{
			//console.log(result[index]);
			listTemp.push(result[index]);
		}
		else
		{
			continue;
		}
	}
	console.log(listTemp);*/
	//return;
	//listAdxPayLoad=conver2adx(result,kpPrevDateDefinition.dataElementId);
	/*console.log("------------------------------------");
	console.log(result);*/
	listAdxPayLoad=conver2adx(result,kpPrevDateDefinition.dataElementId,kpPrevDateDefinition.dataSetId);
	}
	
	//listAdxPayLoad=conver2adx(listTemp,kpPrevDateDefinition.dataElementId,kpPrevDateDefinition.dataSetId);
	//console.log(listAdxPayLoad);
	return listAdxPayLoad;

	

}
//return generated HTS_POS DataElement  from event
function generateAdxTXLinkNewFromEvents(eventsList,dataElementSchemeDefinition)
{
	var listAdxPayLoad=[];
	//var indicators2GenerateList=appConfig.adxEvent.Indicators;
	winston.info("totalList of events: "+eventsList.length);
	var listEventKPPrev=generateTxLinkNewDataElements(eventsList,dataElementSchemeDefinition);
	winston.info("Total list of Tx_Link New event: "+listEventKPPrev.length);
	var nbrOfEventsByDate=[];
	var reformatedList=[];
	for(var index=0;index<listEventKPPrev.length;index++)
	{
		var oEvent=listEventKPPrev[index];
		var aggregatedValue=getAggregatedDataElementValues(oEvent,dataElementSchemeDefinition);
		reformatedList.push({
			id:oEvent.event,
			eventDate:oEvent.eventDate.split("T")[0],
			orgUnit:oEvent.orgUnit,
			sexe:aggregatedValue.sexe,
			categorieKeyPop:aggregatedValue.categorieKeyPop,
			groupAge:aggregatedValue.groupAge
			//partenaireExecution:aggregatedValue.partenaireExecution

		})
	}
	//console.log(listEventKPPrev);
	//return ;
	/*var listTemp=[];
	for(var index=0;index<reformatedList.length;index++)
	{
		if(reformatedList[index].groupAge=="15-19" && reformatedList[index].sexe=='F')
		{
			//console.log(result[index]);
			listTemp.push(reformatedList[index]);
		}
		else
		{
			continue;
		}
	}
	console.log(listTemp);*/
	//now group the event to get number by category
	if(reformatedList.length>0)
	{
		/*var result = alasql('SELECT count(id) as nbre,eventDate,orgUnit,sexe,categorieKeyPop,groupAge,partenaireExecution \
		FROM ? \-------
2020-01-08T16:38:54.599Z - info: Nbre 
		GROUP BY eventDate,orgUnit,sexe,categorieKeyPop,groupAge,partenaireExecution \
		ORDER BY eventDate DESC',[reformatedList]);*/
		var result = alasql('SELECT count(id) as nbre,eventDate,orgUnit,sexe,categorieKeyPop,groupAge \
		FROM ? \
		GROUP BY eventDate,orgUnit,sexe,categorieKeyPop,groupAge \
		ORDER BY eventDate DESC',[reformatedList]);
	//console.log(result);
	var count=0;

	for(var index=0;index<result.length;index++)
	{
		count+=result[index].nbre;
	}
	winston.info("Total after compilation :"+count);
	var kpPrevDateDefinition=dataElementSchemeDefinition;
	//console.log(count);
	//return;
	/*var listTemp=[];
	for(var index=0;index<result.length;index++)
	{
		if(result[index].groupAge=="15-19" && result[index].sexe=='F')
		{
			//console.log(result[index]);
			listTemp.push(result[index]);
		}
		else
		{
			continue;
		}
	}
	console.log(listTemp);*/
	//return;
	//listAdxPayLoad=conver2adx(result,kpPrevDateDefinition.dataElementId);
	/*console.log("------------------------------------");
	console.log(result);*/
	listAdxPayLoad=conver2adx(result,kpPrevDateDefinition.dataElementId,kpPrevDateDefinition.dataSetId);
	}
	
	//listAdxPayLoad=conver2adx(listTemp,kpPrevDateDefinition.dataElementId,kpPrevDateDefinition.dataSetId);
	//console.log(listAdxPayLoad);
	return listAdxPayLoad;

	

}
//convert the aggregated row to adx
function conver2adx(listData,dataElementId,dataSetId)
{
	var listAdxPayLoad=[];
	var currentDate=moment().format(new Date().toJSON());
	var currentZFormatDate=formatDateInZform(currentDate);
	for(var index=0;index<listData.length;index++)
	{
		var sexeOptionId=getSexeCategoryOptionId(listData[index].sexe);
		var categoriePopOptionId=getKeypopCatCategoryOptionId(listData[index].categorieKeyPop);
		var groupeAgeId=getAgeGroupCategoryOptionId(listData[index].groupAge);
		var partenaireExecutionId=getPartenaireExecutionCategoryOptionId(listData[index].partenaireExecution);
		if(sexeOptionId=="" || categoriePopOptionId=="" || groupeAgeId=="" )
		{
			continue;
		}
		
		var xmlObject=[{adx:[{_attr:{xmlns:'urn:ihe:qrph:adx:2015','xmlns:xsi':'http://www.w3.org/2001/XMLSchema-instance',
			'xsi:schemaLocation':'urn:ihe:qrph:adx:2015 ../schema/adx_loose.xsd',exported:currentZFormatDate}},
			{group:[{_attr:{orgUnit:listData[index].orgUnit,period:listData[index].eventDate+"/P1D",completeDate:currentZFormatDate,dataSet:dataSetId}},
				{dataValue:[{_attr:{dataElement:dataElementId,
					Keypop_Type:categoriePopOptionId,Sexe:sexeOptionId,groupAgeTracker:groupeAgeId,
					value:listData[index].nbre}}]}
				
				]}]}];
		listAdxPayLoad.push(
			xml(xmlObject)
		);
	}
	
	//console.log(listAdxPayLoad);
	return listAdxPayLoad;
}
//get category Options Ids related to value
function getSexeCategoryOptionId(item)
{
	var resultId="";
	var itemFound=false;
	for(var index=0;index<appConfig.adxEvent.categoriesOptionsId.sexeIds.length;index++)
	{
		if(item==appConfig.adxEvent.categoriesOptionsId.sexeIds[index].name)
		{
			resultId=appConfig.adxEvent.categoriesOptionsId.sexeIds[index].value;
			itemFound=true;
			break;
		}
	}
	if(!itemFound){
		resultId=getUnknownSexeCategoryOptionId();
	}
	return resultId;
}
function getUnknownSexeCategoryOptionId()
{
	var resultId="";
	for(var index=0;index<appConfig.adxEvent.categoriesOptionsId.sexeIds.length;index++)
	{
		if("unknown"==appConfig.adxEvent.categoriesOptionsId.sexeIds[index].name)
		{
			resultId=appConfig.adxEvent.categoriesOptionsId.sexeIds[index].value;
			break;
		}
	}
	return resultId;
}
function getKeypopCatCategoryOptionId(item)
{
	var resultId="";
	var itemFound=false;
	for(var index=0;index<appConfig.adxEvent.categoriesOptionsId.categoryKeyPopIds.length;index++)
	{
		if(item==appConfig.adxEvent.categoriesOptionsId.categoryKeyPopIds[index].name)
		{
			resultId=appConfig.adxEvent.categoriesOptionsId.categoryKeyPopIds[index].value;
			itemFound=true;
			break;
		}
	}
	if(!itemFound){
		resultId=getUnknownKeypopCatCategoryOptionId();
	}
	return resultId;
}
function getUnknownKeypopCatCategoryOptionId()
{
	var resultId="";
	
	for(var index=0;index<appConfig.adxEvent.categoriesOptionsId.categoryKeyPopIds.length;index++)
	{
		if("unknown"==appConfig.adxEvent.categoriesOptionsId.categoryKeyPopIds[index].name)
		{
			resultId=appConfig.adxEvent.categoriesOptionsId.categoryKeyPopIds[index].value;
			break;
			
		}
	}
	
	return resultId;
}
function getAgeGroupCategoryOptionId(item)
{
	var resultId="";
	var itemFound=false;
	for(var index=0;index<appConfig.adxEvent.categoriesOptionsId.ageGroupIds.length;index++)
	{
		if(item==appConfig.adxEvent.categoriesOptionsId.ageGroupIds[index].name)
		{
			resultId=appConfig.adxEvent.categoriesOptionsId.ageGroupIds[index].value;
			itemFound=true;
			break;
		}
	}
	if(!itemFound){
		resultId=getUnknownAgeGroupCategoryOptionId();
	}
	return resultId;
}
function getUnknownAgeGroupCategoryOptionId()
{
	var resultId="";
	for(var index=0;index<appConfig.adxEvent.categoriesOptionsId.ageGroupIds.length;index++)
	{
		if("unknown"==appConfig.adxEvent.categoriesOptionsId.ageGroupIds[index].name)
		{
			resultId=appConfig.adxEvent.categoriesOptionsId.ageGroupIds[index].value;
			break;
		}
	}
	return resultId;
}
function getPartenaireExecutionCategoryOptionId(item)
{
	var resultId="";
	for(var index=0;index<appConfig.adxEvent.categoriesOptionsId.partenaireExecutionIds.length;index++)
	{
		if(item==appConfig.adxEvent.categoriesOptionsId.partenaireExecutionIds[index].name)
		{
			resultId=appConfig.adxEvent.categoriesOptionsId.partenaireExecutionIds[index].value;
		}
	}
	return resultId;
}
function formatDateInZform(originalDate)
{
	var formatedDate="";
	var dateComponants=[];
	//Check if at least it is timedate format
	var dateCorrected="";
	if(originalDate.includes("T")==false)
	{
		dateCorrected=originalDate.replace(" ","T");
		//console.log("date: "+originalDate);
	}
	else
	{
		dateCorrected=originalDate;
	}
	
	//console.log("Date :"+dateCorrected);
	if(dateCorrected.includes("+"))
	{
		var dateComponants=dateCorrected.split("+");
		if(dateComponants.length>0)
		{
			formatedDate=dateComponants[0];//+"+00:00"
			//formatedDate+="+00:00";
			if(formatedDate.includes("Z")||formatedDate.includes("z"))
			{
				var dateComponant2=formatedDate.split("Z");
				formatedDate=dateComponant2[0];
			}
		}
	}
	else
	{
		//add the timestamp part 
		//console.log(dateCorrected+"T00:00:00.000+01:00");
		formatedDate=dateCorrected+"T00:00:00.000";
	}
	
	return formatedDate+"+01:00";
}
//get aggragateDataElement values from oEvent
function getAggregatedDataElementValues(event,dataElementSchemeDefinition)
{
	var aggregatedValue={
		sexe:"",
		categorieKeyPop:"",
		groupAge:"",
        partenaireExecution:""
	}
	var aggregateDataElements=dataElementSchemeDefinition.aggregateDataElements;
	for(var indexValues=0;indexValues<event.dataValues.length;indexValues++)
	{	
		var odataValue=event.dataValues[indexValues];
		switch(odataValue.dataElement)
		{
			case aggregateDataElements.sexe:
				//winston.warn("enPreventionVIH :"+odataValue.value);
				aggregatedValue.sexe=odataValue.value;
				break;
			case aggregateDataElements.categorieKeyPop:
				//winston.warn("enrNombrePreservatifMasculinRemisAuClient :"+odataValue.value);
				aggregatedValue.categorieKeyPop=odataValue.value;
				break;
			case aggregateDataElements.groupAge:
				//winston.warn("iraKeypopReferePourDepistageVIH :"+odataValue.value);
				aggregatedValue.groupAge=odataValue.value;
				break;
			case aggregateDataElements.partenaireExecution:
				//winston.warn("iraKeypopReferePourDepistageVIH :"+odataValue.value);
				aggregatedValue.partenaireExecution=odataValue.value;
				break;
		}

	}
	return aggregatedValue;
}

function generateKPPrevDataElements(eventsList,dataElementSchemeDefinition){
	var listValidEvents=[];
	
	var kpPrevDataDefinition=dataElementSchemeDefinition;
	//console.log(kpPrevDataDefinition);
	if(kpPrevDataDefinition!=null)
	{
		for(var index=0;index<eventsList.length;index++)
		{
			var hasEnPreventionHIV_Yes=false;
			var hasNbrePreservatifRemisAuclient_Sup=false;
			var hasKeyPopReferePourDepistageVIH_Yes=false;
			var oEvent=eventsList[index];
			
			/*if(oEvent.event=="i3sxOhux5Mf")
			{
				console.log("******************************************");
				console.log("position:"+index);
				//console.log(oEvent);
			}*/
			//winston.warn("---------------------------------------------------------");
			for(var indexValues=0;indexValues<oEvent.dataValues.length;indexValues++)
			{	
				var odataValue=oEvent.dataValues[indexValues];
				switch(odataValue.dataElement)
				{
					case kpPrevDataDefinition.eventDataValues.enrPreventionVIH:
						//winston.warn("enPreventionVIH :"+odataValue.value);
						if(odataValue.value=="true")
						{
							hasEnPreventionHIV_Yes=true;
						}
						break;
					case kpPrevDataDefinition.eventDataValues.enrNombrePreservatifMasculinRemisAuClient:
						//winston.warn("enrNombrePreservatifMasculinRemisAuClient :"+odataValue.value);
						if(odataValue.value!="")
						{
							if(parseInt(odataValue.value)>0)
							{
								hasNbrePreservatifRemisAuclient_Sup=true;
							}
						}
						break;
						case kpPrevDataDefinition.eventDataValues.iraKeypopReferePourDepistageVIH:
							//winston.warn("iraKeypopReferePourDepistageVIH :"+odataValue.value);
							if(odataValue.value=="true")
							{
								hasKeyPopReferePourDepistageVIH_Yes=true;
							}
							break;
				}

			}
			/*if(oEvent.event=="i3sxOhux5Mf")
			{
				console.log("hasEnPreventionHIV_Yes:"+hasEnPreventionHIV_Yes);
				console.log("hasKeyPopReferePourDepistageVIH_Yes:"+hasKeyPopReferePourDepistageVIH_Yes);
				console.log("hasNbrePreservatifRemisAuclient_Sup:"+hasNbrePreservatifRemisAuclient_Sup);
			}*/
			if(hasEnPreventionHIV_Yes || hasKeyPopReferePourDepistageVIH_Yes || hasNbrePreservatifRemisAuclient_Sup)
			{
				//console.log("Selected :"+oEvent.event);
				listValidEvents.push(oEvent);
			}
		}
	}
	return listValidEvents;
	
}
function generateHTTSTDataElements(eventsList,dataElementSchemeDefinition){
	var listValidEvents=[];
	
	var kpPrevDataDefinition=dataElementSchemeDefinition;
	//console.log(kpPrevDataDefinition);
	if(kpPrevDataDefinition!=null)
	{
		for(var index=0;index<eventsList.length;index++)
		{
			var hasCdvClientARecuResultatTestVIH_Yes=false;
			var hasCdvResultatVIH_PositifOrNegatif=false;
			var oEvent=eventsList[index];
			/*
			if(oEvent.event=="uio2gIb0His")
			{
				console.log("@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@");
				console.log(oEvent.dataValues);
			}*/
			for(var indexValues=0;indexValues<oEvent.dataValues.length;indexValues++)
			{	
				var odataValue=oEvent.dataValues[indexValues];
				switch(odataValue.dataElement)
				{
					
					case kpPrevDataDefinition.eventDataValues.cdvClientARecuResultatTestVIH:
						//winston.warn("enPreventionVIH :"+odataValue.value);
						if(odataValue.value=="true")
						{
							hasCdvClientARecuResultatTestVIH_Yes=true;
							
						}
						/* if(oEvent.event=="uio2gIb0His")
						{
							winston.info("######hasCdvClientARecuResultatTestVIH_Yes#####: "+hasCdvClientARecuResultatTestVIH_Yes);
						} */
						break;
					case kpPrevDataDefinition.eventDataValues.cdvResultatVIH:
						//winston.warn("enrNombrePreservatifMasculinRemisAuClient :"+odataValue.value);
						if(odataValue.value =="Négatif" || odataValue.value =="Positif")
						{
							hasCdvResultatVIH_PositifOrNegatif=true;
						}
						/* if(oEvent.event=="uio2gIb0His")
						{
							winston.info("######hasCdvResultatVIH_PositifOrNegatif#####: "+hasCdvResultatVIH_PositifOrNegatif);
						} */
						break;
				}

			}
			/*if(oEvent.event=="i3sxOhux5Mf")
			{
				console.log("hasEnPreventionHIV_Yes:"+hasEnPreventionHIV_Yes);
				console.log("hasKeyPopReferePourDepistageVIH_Yes:"+hasKeyPopReferePourDepistageVIH_Yes);
				console.log("hasNbrePreservatifRemisAuclient_Sup:"+hasNbrePreservatifRemisAuclient_Sup);
			}*/
			if(hasCdvClientARecuResultatTestVIH_Yes==true && hasCdvResultatVIH_PositifOrNegatif ==true)
			{
				//console.log("Selected :"+oEvent.event);
				listValidEvents.push(oEvent);
			}
		}
	}
	return listValidEvents;
	
}
function generateHTSPOS1DataElements(eventsList,dataElementSchemeDefinition){
	var listValidEvents=[];
	
	var kpPrevDataDefinition=dataElementSchemeDefinition;
	//console.log(kpPrevDataDefinition);
	if(kpPrevDataDefinition!=null)
	{
		for(var index=0;index<eventsList.length;index++)
		{
			var hasCdvClientARecuResultatTestVIH_Yes=false;
			var hasCdvResultatVIH_PositifOrNegatif=false;
			var oEvent=eventsList[index];
			/*
			if(oEvent.event=="uio2gIb0His")
			{
				console.log("@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@");
				console.log(oEvent.dataValues);
			}*/
			for(var indexValues=0;indexValues<oEvent.dataValues.length;indexValues++)
			{	
				var odataValue=oEvent.dataValues[indexValues];
				switch(odataValue.dataElement)
				{
					
					case kpPrevDataDefinition.eventDataValues.cdvClientARecuResultatTestVIH:
						//winston.warn("enPreventionVIH :"+odataValue.value);
						if(odataValue.value=="true")
						{
							hasCdvClientARecuResultatTestVIH_Yes=true;
							
						}
						/* if(oEvent.event=="uio2gIb0His")
						{
							winston.info("######hasCdvClientARecuResultatTestVIH_Yes#####: "+hasCdvClientARecuResultatTestVIH_Yes);
						} */
						break;
					case kpPrevDataDefinition.eventDataValues.cdvResultatVIH:
						//winston.warn("enrNombrePreservatifMasculinRemisAuClient :"+odataValue.value);
						if(odataValue.value =="Positif")
						{
							hasCdvResultatVIH_PositifOrNegatif=true;
						}
						/* if(oEvent.event=="uio2gIb0His")
						{
							winston.info("######hasCdvResultatVIH_PositifOrNegatif#####: "+hasCdvResultatVIH_PositifOrNegatif);
						} */
						break;
				}

			}
			/*if(oEvent.event=="i3sxOhux5Mf")
			{
				console.log("hasEnPreventionHIV_Yes:"+hasEnPreventionHIV_Yes);
				console.log("hasKeyPopReferePourDepistageVIH_Yes:"+hasKeyPopReferePourDepistageVIH_Yes);
				console.log("hasNbrePreservatifRemisAuclient_Sup:"+hasNbrePreservatifRemisAuclient_Sup);
			}*/
			if(hasCdvClientARecuResultatTestVIH_Yes==true && hasCdvResultatVIH_PositifOrNegatif ==true)
			{
				//console.log("Selected :"+oEvent.event);
				listValidEvents.push(oEvent);
			}
		}
	}
	return listValidEvents;
	
}
function generateHTSPOSDataElements(eventsList,dataElementSchemeDefinition){
	var listValidEvents=[];
	
	var kpPrevDataDefinition=dataElementSchemeDefinition;
	//console.log(kpPrevDataDefinition);
	if(kpPrevDataDefinition!=null)
	{
		for(var index=0;index<eventsList.length;index++)
		{
			var hascdvResultatVIHAvantSessionDepistage_Positif=false;
			
			var oEvent=eventsList[index];
			for(var indexValues=0;indexValues<oEvent.dataValues.length;indexValues++)
			{	
				var odataValue=oEvent.dataValues[indexValues];
				switch(odataValue.dataElement)
				{
					case kpPrevDataDefinition.eventDataValues.cdvResultatVIHAvantSessionDepistage:
						//winston.warn("enPreventionVIH :"+odataValue.value);
						if(odataValue.value=="Positif")
						{
							hascdvResultatVIHAvantSessionDepistage_Positif=true;
						}
						break;
					
				}

			}
			/*if(oEvent.event=="i3sxOhux5Mf")
			{
				console.log("hasEnPreventionHIV_Yes:"+hasEnPreventionHIV_Yes);
				console.log("hasKeyPopReferePourDepistageVIH_Yes:"+hasKeyPopReferePourDepistageVIH_Yes);
				console.log("hasNbrePreservatifRemisAuclient_Sup:"+hasNbrePreservatifRemisAuclient_Sup);
			}*/
			if(hascdvResultatVIHAvantSessionDepistage_Positif)
			{
				//console.log("Selected :"+oEvent.event);
				listValidEvents.push(oEvent);
			}
		}
	}
	return listValidEvents;
	
}
function generateTxLinkNewDataElements(eventsList,dataElementSchemeDefinition){
	var listValidEvents=[];
	
	var kpPrevDataDefinition=dataElementSchemeDefinition;
	//console.log(kpPrevDataDefinition);
	if(kpPrevDataDefinition!=null)
	{
		for(var index=0;index<eventsList.length;index++)
		{
			var hasCdvClientTesteVIHPosAComTraitement_Yes=false;
			
			var oEvent=eventsList[index];
			for(var indexValues=0;indexValues<oEvent.dataValues.length;indexValues++)
			{	
				var odataValue=oEvent.dataValues[indexValues];
				switch(odataValue.dataElement)
				{
					case kpPrevDataDefinition.eventDataValues.cdvClientTesteVIHPosAComTraitement:
						//winston.warn("enPreventionVIH :"+odataValue.value);
						if(odataValue.value=="true")
						{
							hasCdvClientTesteVIHPosAComTraitement_Yes=true;
						}
						break;
					
				}

			}
			/*if(oEvent.event=="i3sxOhux5Mf")
			{
				console.log("hasEnPreventionHIV_Yes:"+hasEnPreventionHIV_Yes);
				console.log("hasKeyPopReferePourDepistageVIH_Yes:"+hasKeyPopReferePourDepistageVIH_Yes);
				console.log("hasNbrePreservatifRemisAuclient_Sup:"+hasNbrePreservatifRemisAuclient_Sup);
			}*/
			if(hasCdvClientTesteVIHPosAComTraitement_Yes)
			{
				//console.log("Selected :"+oEvent.event);
				listValidEvents.push(oEvent);
			}
		}
	}
	return listValidEvents;
	
}
//return the KP_PREV dataElement definition from the config file
function getKpPrevDataDefinition(dataElementScheme)
{
	var kpPrevDataDefinition=null;
	for(var i=0;i<appConfig.adxEvent.dataElements.length;i++)
	{
		if(appConfig.adxEvent.dataElements[i].name==dataElementScheme){
			kpPrevDataDefinition=appConfig.adxEvent.dataElements[i];
		}
	}
	return kpPrevDataDefinition;
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
		if(resp!=null)
		{
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
				return callback([]);
			}
		}
		else{
			return callback([]);
		}
		
	});//end of needle
	
}
function getStageEventsByPeriodSkipPaging(startDate,endDate,incrementDate,programStage,parentOrgUnit,globalEventsList,callback)
{
	var urlRequest="";
	urlRequest=`${baseUrlAPI}/events.json?orgUnit=${parentOrgUnit}&ouMode=DESCENDANTS&programStage=${programStage}&startDate=${startDate}&endDate=${incrementDate}&skipPaging=true`;		
	console.log(urlRequest);
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
		if(resp!=null)
		{
			if(resp.statusCode==200)
			{
				//console.log(resp.body.events);
				//var responseBundle=JSON.stringify(resp.body.toString('utf8'));
				//var response=JSON.parse(resp.body);
				
				for(var index=0;index<resp.body.events.length;index++)
				{
					globalEventsList.push(resp.body.events[index]);
				}
				upDateAdxPager(parentOrgUnit,programStage,incrementDate,
					appConfig.adxEvent.endDate,incrementDate,function(result){
						winston.info("Updated event pager: "+result);
						return callback(globalEventsList);
					})//end of upDateAdxPager	
			}
			else{
				return [];
			}
		}
		
	});//end of needle
	
}
function getTrackedEntities(currentPage,program,parentOrgUnit,pageSize,globalEntitiesList,callback)
{
	var urlRequest="";
	var programStartDate=appConfig.programStage.startDate;
	var programEndDate=appConfig.programStage.endDate;
	if(currentPage==0)
	{
		//console.log("First Iteration");
		//urlRequest=`${baseUrlAPI}/trackedEntityInstances.json?ou=${parentOrgUnit}&ouMode=DESCENDANTS&program=${program}&pageSize=${pageSize}&totalPages=true&page=1&fields=trackedEntityInstance,orgUnit,attributes`;
		urlRequest=`${baseUrlAPI}/trackedEntityInstances.json?ou=${parentOrgUnit}&ouMode=DESCENDANTS&program=${program}&programStartDate=${programStartDate}&programEndDate=${programEndDate}&pageSize=${pageSize}&totalPages=true&page=1&fields=trackedEntityInstance,orgUnit,attributes`;
	
	}
	else{
		//console.log("Other iteration");
		//urlRequest=`${baseUrlAPI}/trackedEntityInstances.json?ou=${parentOrgUnit}&ouMode=DESCENDANTS&program=${program}&pageSize=${pageSize}&totalPages=true&page=${currentPage}&fields=trackedEntityInstance,orgUnit,attributes`;
		urlRequest=`${baseUrlAPI}/trackedEntityInstances.json?ou=${parentOrgUnit}&ouMode=DESCENDANTS&program=${program}&programStartDate=${programStartDate}&programEndDate=${programEndDate}&pageSize=${pageSize}&totalPages=true&page=${currentPage}&fields=trackedEntityInstance,orgUnit,attributes`;
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
		if(resp!=null)
		{
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
	winston.info(numberOfEventWithStatusCompleted +" events has been already completed");
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
	/*
	if(oEvent.event=="G1yvrmzGQJW"){
		console.log(entityAttribute);
	}*/
	for(var indexAttribute=0;indexAttribute<entityAttribute.length;indexAttribute++){
		var correspondingDataElement=getDataElementToTransfert(entityAttribute[indexAttribute].attribute,
			dataElementsToTransfert);
			if(correspondingDataElement!="")
			{
				
				//Check if the event has already a value
				var eventHasValue=checkIfEventHasAlreadyDateElementValue(correspondingDataElement,
					oEvent);
					//if the event does not contain the correspondingdataElement then assign it to the event
					
					if(oEvent.event=="xwqxcc9Ifvd")
					{
						console.log("@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@");
						winston.warn("EventHasValue: "+eventHasValue);
						winston.warn("Attribute value: "+entityAttribute[indexAttribute].value);
						winston.warn("Corresponding data element: "+correspondingDataElement);
					}
				
					if(!eventHasValue){
						/*
						if(oEvent.event=="yoko2mK8vkq")
						{
							console.log("@@@@@@@@@@@@@@@@@@@@@@@11111@@@@@@@@@@@@@@@@@@@@@@@@@@@");
							winston.warn("Adding new dataElement to the collection!!");
						}*/
				
					var attributeValue= entityAttribute[indexAttribute].value;
					_event=oEvent;
					_event.dataValues.push({"dataElement":correspondingDataElement,"value":attributeValue});
					break;
					/*winston.info("$$$$$$"+oEvent.event+"=>"+correspondingDataElement+":"+attributeValue);
					if(oEvent.event=="xwqxcc9Ifvd")
					{
						console.log(_event);
					}*/
				}
				else{
					/*
					if(oEvent.event=="yoko2mK8vkq")
					{
						console.log("@@@@@@@@@@@@@@@@@@@@@@@22222@@@@@@@@@@@@@@@@@@@@@@@@@@@");
						winston.warn("Updating new data element!!");
					}*/
					/* _event=oEvent;
					for(var i=0;i<oEvent.dataValues.length;i++)
					{
						
						if(oEvent.dataValues[i].dataElement==correspondingDataElement  )
						{
							_event.dataValues[i].value=entityAttribute[indexAttribute].value;
							
							
							break;
						}
					} */
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
exports.getDataElementToTransfert = getDataElementToTransfert;
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
			else{
				winston.warn("Event "+event.event+" has value null");
			}
			
		}
	}
	return hasValue;
	//return false;
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
var upDateAdxPager=function(orgUnitId,programStageId,startDate,endDate,incrementDate,callback)
{
	var incrementDays=appConfig.adxEvent.incrementDays;
	var _startDate=new Date(startDate);
	var _endDate=new Date(endDate);
	var _incrementDate;
	
	winston.info("The next start date to get event to push :"+startDate);
	//var incrementDate=new Date(endDate);
	
	var res=adxPagerSchemaDefinition.findOneAndUpdate({"orgId":orgUnitId,"stageId":programStageId},
	{$set:{"startDate":_startDate,"endDate":_endDate,
		"incrementDate":_incrementDate}},{upsert:true},(err, doc) => {
		if (err) {
			console.log(err);
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
//reinitialise the counter collection of tracked attribute 2 data eleement transfert
var reinitEntityPager	= function(callback)
{
	var requestResult=entityPagerSchemaDefinition.remove({}).exec(function(error,doc){
		if(error) {
			console.log("Error: Failed to delete the collection record!");
			callback (false);
		}
		else
		{
			callback(true);
		}
		
		});
}
//reinitialise the counter collection of adxpager 
var reinitAdxPager	= function(callback)
{
	var requestResult=adxPagerSchemaDefinition.remove({}).exec(function(error,doc){
		if(error) {
			console.log("Error: Failed to delete the collection record!");
			callback (false);
		}
		else
		{
			callback(true);
		}
		
		});
}
//reinitialise the counter collection of eventlock 
var reinitEventPager	= function(callback)
{
	var requestResult=stagePagerSchemaDefinition.remove({}).exec(function(error,doc){
		if(error) {
			console.log("Error: Failed to delete the collection record!");
			callback (false);
		}
		else
		{
			callback(true);
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
var getAdxPager=function(orgUnitId,programStageId,startDate,endDate,callback)
{
	//console.log(orgUnitId+","+programStageId+","+startDate+","+endDate);
	var _startDate=new Date(startDate);
	var _endDate=new Date(endDate);
	var requestResult=adxPagerSchemaDefinition.findOne({"orgId":orgUnitId,"stageId":programStageId},{"_id":0}).exec(function(error,doc){
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
