# Transform tracked entities data to aggregated data element
Extracted and transform tracked entities data from tracker module to aggregated based on defined data element categories and tracher filter rules. This app allow to synchronize data from tracker to aggregated using ADX and to lock(complete) and unklock (activate) a stage.

## Architecture
This app is a nodejs module. It uses mongodb as local cash for counter and permanent variable accross session
## Installation

### Nodejs and mongodb
* [Nodejs V10.15.1](https://docs.mongodb.com/manual/tutorial/install-mongodb-enterprise-on-ubuntu/)
* [Mongodb](https://docs.mongodb.com/manual/tutorial/install-mongodb-enterprise-on-ubuntu/)
### Start server
Two main componants must be started.
* Start the mongodb
```
sudo service mongod start
```
* check if mongo is running
```
mongo
```

* check if nodejs is running
```
node --version
```

### The conversion app
```
git clone https://github.com/gerard-bisama/dhis2-tracker2aggregated.git
```
To run the app
```
cd his2-tracker2aggregated
npm install #only for the first run
npm start
```

### Configurations
To activate and deactivate a stage, in the configuration file config.json, the following parameters can be changed

```
"programStageId":"dWlyeXKe8Wb", #the id is the stage to lock or unlock
"programId":"nXjCeCIjIYG", #The id of the program, this should not change often
"parentOrgUnit":"OdGGWjxNuka", #The Id or orgUnit where to lock or unlock the program
"nbreEventsToProcess":300, #not to change
"startDate":"2018-10-01", #date from to
"endDate":"2019-12-31"
```
To sync aggregated from the tracker to aggregated module

```
"orgId":"zJLpGWyTRc7", #The Id or orgUnit to process
"startDate":"2019-10-01", #date from to
"endDate":"2019-12-31",
```
### Commands

Every times that to parentOrgUnit is changed the cache must be cleared. 

To clear the cache in the case of copying attributes value to data event's data element. this was done to get the poper configuration for generating aggregated data element. Often not used

```
curl http://localhost:8084/delattr2stagepager
````
To clear the cache in the case of locking and unlocking the event
```
curl http://localhost:8084/deleventpager
```
To clear the cache in the case of synchronizing tracker data to aggregated
```
curl http://localhost:8084/deladxpager
```
For processes,
To lock the events 
```
curl http://localhost:8084/lockevents
```
To unlock the events
```
curl http://localhost:8084/unlockevents
```
To generate KP_PREV and PP_PREV RELATED dataElements

```
curl http://localhost:8084/convertevent2adx/prev
```
To generate HT_TST RELATED dataElements

```
curl http://localhost:8084/convertevent2adx/test
```
To generate HT_POS RELATED dataElements

```
curl http://localhost:8084/convertevent2adx/pos
```
To generate Tx_Link_new RELATED dataElements

```
curl http://localhost:8084/convertevent2adx/linknew
```

Taratataaa!!!!


