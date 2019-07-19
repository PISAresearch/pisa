import React, { Component } from 'react'
import ZeroconfContext from '../../contexts/ZeroconfContext';

import Button from '@material-ui/core/Button';

class HomeView extends Component {
  state = {
  };

  render() {
    return (
      <ZeroconfContext.Consumer>
      { ({
          ready,
          done,
          handlePayClicked
        }) =>
        {
          if (!ready) {
            return <p>Loading...</p>;
          }

          return (
            <React.Fragment>
              <Button variant="contained" onClick={handlePayClicked}>Pay 0.01 Ξ</Button> and get the good stuff!
              { done && (
                <p>✓</p>
              )}
            </React.Fragment>
          )
        }
      }
      </ZeroconfContext.Consumer>
    );
  }
}

export default HomeView;
